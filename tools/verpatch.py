#!/usr/bin/env python3
"""改寫 PE 檔裡的 VS_VERSIONINFO：拿掉檔案描述與公司，順便把版號改成我們自己的。

為什麼要自己寫：electron-builder 25 在 Linux 上是靠 wine 跑 rcedit.exe 來改這些
字串（winPackager.js：process.platform 是 win32/darwin 才走內建 rcedit，否則
execWine），這個沙箱裡沒有 wine，所以 build.win.signAndEditExecutable 只能維持
false，內層 exe 也就一直留著 Electron / GitHub, Inc. 的字串。

安全前提（這是整個做法能成立的原因）：
  * 只改「版本資源那一塊資料」裡面的位元組，資源目錄、節區表、RVA 一律不動。
  * 新的區塊一定比舊的短（我們是在刪字串、換更短的字串），所以原地寫得下，
    後面補零。資源目錄裡的 Size 欄位維持原值——讀版本資訊的人看的是每個結構
    自己的 wLength，尾巴多出來的零沒有人會去解析。
  * 因此載入器看到的東西完全沒變：Windows 載入 exe 時不會解析 VS_VERSIONINFO，
    就算這塊資料壞掉也只影響「內容」對話框，不會影響能不能執行。
  * 序列化器的正確性用往返測試證明：先把原本的區塊解析成樹再重新組回去，
    要求位元組完全相同，才准拿它去產生新的區塊。
"""
import struct
import sys

RT_VERSION = 16


class Pe:
    def __init__(self, fh):
        self.fh = fh
        fh.seek(0x3C)
        pe_off = struct.unpack('<I', fh.read(4))[0]
        fh.seek(pe_off)
        assert fh.read(4) == b'PE\0\0', '不是 PE 檔'
        _, nsec, _, _, _, opt_size, _ = struct.unpack('<HHIIIHH', fh.read(20))
        self.opt_off = pe_off + 24
        opt = fh.read(opt_size)
        magic = struct.unpack('<H', opt[:2])[0]
        self.checksum_off = self.opt_off + 64  # OptionalHeader.CheckSum
        dd = 96 if magic == 0x10B else 112
        self.res_rva, self.res_size = struct.unpack('<II', opt[dd + 16:dd + 24])
        self.sections = []
        for _ in range(nsec):
            raw = fh.read(40)
            name = raw[:8].rstrip(b'\0').decode('latin1')
            vsize, vaddr, rsize, raddr = struct.unpack('<IIII', raw[8:24])
            self.sections.append((name, vaddr, vsize, raddr, rsize))

    def rva_to_off(self, rva):
        for _, vaddr, vsize, raddr, rsize in self.sections:
            if vaddr <= rva < vaddr + max(vsize, rsize):
                return raddr + (rva - vaddr)
        raise ValueError(f'RVA {rva:#x} 不在任何節區裡')


def read_at(fh, off, size):
    fh.seek(off)
    data = fh.read(size)
    assert len(data) == size, f'讀不到 {size} 個位元組（offset {off}）'
    return data


def res_entries(fh, pe, base_off, want_type):
    """走資源目錄，回傳 RT_VERSION 的每個 (lang, data_rva, size, size 欄位的檔案位移)。"""
    out = []

    def directory(off, level):
        hdr = read_at(fh, off, 16)
        named, ids = struct.unpack('<HH', hdr[12:16])
        raw = read_at(fh, off + 16, (named + ids) * 8)
        for i in range(named + ids):
            name, offset = struct.unpack_from('<II', raw, i * 8)
            child = base_off + (offset & 0x7FFFFFFF)
            if offset & 0x80000000:  # 還是目錄
                if level == 0 and name != want_type:
                    continue  # 只走我們要的那個型別
                directory(child, level + 1)
                continue
            if level < 2:
                continue  # 型別/名稱層直接掛資料的檔案這裡不處理
            data_rva, size = struct.unpack('<II', read_at(fh, child, 8))
            out.append((name, data_rva, size, child + 4))

    directory(base_off, 0)
    return out


def pad4(n):
    return (-n) % 4


class Node:
    """VS_VERSIONINFO 樹的一個節點：{wLength, wValueLength, wType, szKey, Value, 子節點}。

    只有這四種鍵有子節點；其餘（String / Var）一律是葉節點，這是規格寫死的結構，
    所以不需要用啟發式去猜。8 個十六進位字元的鍵是 StringTable。
    """

    CONTAINERS = ('VS_VERSION_INFO', 'StringFileInfo', 'VarFileInfo')

    def __init__(self, key, wtype, value, children, vlen_chars):
        self.key = key
        self.wtype = wtype
        self.value = value          # 原始位元組
        self.children = children
        self.vlen_chars = vlen_chars  # wValueLength 是否以字元計（文字節點）

    @property
    def is_container(self):
        return self.key in self.CONTAINERS or _is_langid(self.key)


def _is_langid(key):
    return len(key) == 8 and all(c in '0123456789abcdefABCDEF' for c in key)


def parse(buf, off):
    """buf 必須正好是版本資源那一塊（buf[0] 就是 VS_VERSIONINFO 的開頭）。

    規格裡所有的補齊都是相對於區塊開頭做 4 位元組對齊，而區塊開頭在檔案裡本來
    就是 4 對齊的，所以這裡直接用 buf 內的絕對位移算補齊。
    """
    length, vlen, wtype = struct.unpack_from('<HHH', buf, off)
    assert length >= 6, f'wLength={length} 太小（offset {off}）'
    end = off + length
    p = off + 6
    kend = buf.index(b'\0\0', p)
    if (kend - p) % 2:
        kend += 1
    key = buf[p:kend].decode('utf-16-le')
    p = kend + 2
    p += pad4(p)
    vlen_chars = wtype == 1
    nbytes = vlen * 2 if vlen_chars else vlen
    value = buf[p:p + nbytes]
    node = Node(key, wtype, value, [], vlen_chars)
    if not node.is_container:
        return node, end
    p += nbytes
    p += pad4(p)
    while p + 6 <= end:
        child, p = parse(buf, p)
        node.children.append(child)
        p += pad4(p)
    return node, end


def build(node, at=0):
    """組回位元組。at 是這個節點在整個區塊裡的位移（補齊要用得到）。"""
    key = node.key.encode('utf-16-le') + b'\0\0'
    out = bytearray(b'\0\0\0\0\0\0') + key
    out += b'\0' * pad4(at + len(out))
    vlen = len(node.value) // 2 if node.vlen_chars else len(node.value)
    out += node.value
    if node.children:
        out += b'\0' * pad4(at + len(out))
        for i, child in enumerate(node.children):
            out += build(child, at + len(out))
            if i != len(node.children) - 1:
                out += b'\0' * pad4(at + len(out))
    struct.pack_into('<HHH', out, 0, len(out), vlen, node.wtype)
    return bytes(out)


def dump(node, depth=0):
    text = ''
    if node.value and node.vlen_chars:
        text = ' = ' + repr(node.value.decode('utf-16-le').rstrip('\0'))
    elif node.value:
        text = f' = <{len(node.value)} 位元組>'
    print('   ' + '  ' * depth + node.key + text)
    for child in node.children:
        dump(child, depth + 1)


def text_value(s):
    return (s + '\0').encode('utf-16-le')


def edit_strings(root, sets, drops):
    """在每一個 StringTable 裡套用修改。回傳實際改動的說明，方便肉眼核對。"""
    changed = []
    for sfi in root.children:
        if sfi.key != 'StringFileInfo':
            continue
        for table in sfi.children:
            kept = []
            for s in table.children:
                if s.key in drops:
                    changed.append(f'[{table.key}] 刪掉 {s.key}')
                    continue
                if s.key in sets:
                    was = s.value.decode('utf-16-le').rstrip('\0')
                    now = sets[s.key]
                    if was != now:
                        s.value = text_value(now)
                        changed.append(f'[{table.key}] {s.key}: {was!r} → {now!r}')
                kept.append(s)
            have = {s.key for s in kept}
            for key, val in sets.items():
                if key in have or key in drops:
                    continue
                kept.append(Node(key, 1, text_value(val), [], True))
                changed.append(f'[{table.key}] 新增 {key} = {val!r}')
            table.children = kept
    return changed


def edit_fixed(root, version):
    """VS_FIXEDFILEINFO 裡也有一份版號，有些工具讀的是這一份。"""
    parts = [int(x) for x in version.split('.')] + [0, 0, 0, 0]
    ms = (parts[0] << 16) | parts[1]
    ls = (parts[2] << 16) | parts[3]
    v = bytearray(root.value)
    assert len(v) == 52 and struct.unpack_from('<I', v, 0)[0] == 0xFEEF04BD, '固定區塊不對'
    struct.pack_into('<IIII', v, 8, ms, ls, ms, ls)
    root.value = bytes(v)
    return f'固定區塊版號 → {parts[0]}.{parts[1]}.{parts[2]}.{parts[3]}'


def fix_checksum(path, checksum_off):
    """把 OptionalHeader.CheckSum 重算。

    使用者的防毒已經擋過一次更新腳本了，沒必要再留一個「PE 檢查碼跟內容不符」
    的特徵給它加分。演算法就是把整個檔案當成一串 16 位元字組做 1 的補數和
    （檢查碼欄位本身當成 0），最後加上檔案長度。
    """
    from array import array

    total = 0
    size = 0
    with open(path, 'rb') as fh:
        first = True
        while True:
            chunk = fh.read(1 << 23)
            if not chunk:
                break
            size += len(chunk)
            if first:
                chunk = bytearray(chunk)
                chunk[checksum_off:checksum_off + 4] = b'\0\0\0\0'
                first = False
            if len(chunk) % 2:
                total += chunk[-1]
                chunk = chunk[:-1]
            words = array('H')
            words.frombytes(bytes(chunk))
            if sys.byteorder != 'little':
                words.byteswap()
            total += sum(words)
    while total >> 16:
        total = (total & 0xFFFF) + (total >> 16)
    value = (total + size) & 0xFFFFFFFF
    with open(path, 'r+b') as fh:
        fh.seek(checksum_off)
        fh.write(struct.pack('<I', value))
    return value


def version_blocks(path):
    """回傳 (pe, [(lang, 檔案位移, 資源大小)])，只讀標頭和資源目錄。"""
    with open(path, 'rb') as fh:
        pe = Pe(fh)
        base = pe.rva_to_off(pe.res_rva)
        out = []
        for lang, rva, size, _ in res_entries(fh, pe, base, RT_VERSION):
            out.append((lang, pe.rva_to_off(rva), size))
        return pe, out


def patch(path, sets, drops, version, dry_run=False):
    pe, blocks = version_blocks(path)
    assert blocks, '這個檔案沒有版本資源'
    report = []
    for lang, off, size in blocks:
        with open(path, 'rb') as fh:
            blob = read_at(fh, off, size)
        root, used = parse(blob, 0)
        assert root.key == 'VS_VERSION_INFO', f'開頭不是 VS_VERSION_INFO 而是 {root.key!r}'
        # 往返測試：先證明序列化器能把原樣的樹組回一模一樣的位元組，
        # 才有資格拿它去產生新的區塊。
        again = build(root)
        assert again == blob[:used], (
            f'往返測試失敗（lang {lang:#06x}）：原 {used} 位元組，組回 {len(again)} 位元組'
        )
        report.append(f'lang {lang:#06x}：往返測試通過（{used}/{size} 位元組）')
        report += [f'  {c}' for c in edit_strings(root, sets, drops)]
        report.append('  ' + edit_fixed(root, version))
        new = build(root)
        assert len(new) <= size, f'新區塊 {len(new)} 位元組，塞不進原本的 {size}'
        check, _ = parse(new, 0)
        assert build(check) == new, '新區塊自己解析不回來'
        report.append(f'  新區塊 {len(new)} 位元組（原 {used}），後面補 {size - len(new)} 個零')
        if dry_run:
            continue
        with open(path, 'r+b') as fh:
            fh.seek(off)
            fh.write(new + b'\0' * (size - len(new)))
    if not dry_run:
        with open(path, 'rb') as fh:
            stored = struct.unpack('<I', read_at(fh, pe.checksum_off, 4))[0]
        # 原本就是 0 的檔案（electron.exe 和 NSIS 產出的 exe 都是）就維持 0：
        # 那是它們的工具鏈本來的樣子，補一個上去反而是多出來的差異。
        # 原本有值的才要重算，否則會變成「有檢查碼但跟內容不符」——那才是可疑特徵。
        if stored:
            report.append(f'PE 檢查碼 {stored:#010x} → {fix_checksum(path, pe.checksum_off):#010x}')
        else:
            report.append('PE 檢查碼原本就是 0，維持 0')
    return report


def main(argv):
    import argparse

    ap = argparse.ArgumentParser(description='改寫 PE 的版本資源（原地、不動資源目錄）')
    ap.add_argument('mode', choices=['dump', 'clean'])
    ap.add_argument('files', nargs='+')
    ap.add_argument('--version', default='')
    ap.add_argument('--product', default='')
    ap.add_argument('--copyright', default='')
    ap.add_argument('--dry-run', action='store_true')
    args = ap.parse_args(argv)

    for path in args.files:
        print(f'== {path}')
        if args.mode == 'dump':
            pe, blocks = version_blocks(path)
            for lang, off, size in blocks:
                with open(path, 'rb') as fh:
                    blob = read_at(fh, off, size)
                root, used = parse(blob, 0)
                print(f'   lang {lang:#06x} @{off} size={size} used={used}')
                dump(root)
            continue
        assert args.version and args.product, 'clean 需要 --version 和 --product'
        sets = {
            'ProductName': args.product,
            'ProductVersion': args.version,
            'FileVersion': args.version,
            'InternalName': args.product,
            'OriginalFilename': '',
        }
        if args.copyright:
            sets['LegalCopyright'] = args.copyright
        # 使用者要的就是這兩個欄位消失：Explorer 的「檔案描述」和「公司」。
        drops = {'FileDescription', 'CompanyName'}
        for line in patch(path, sets, drops, args.version, args.dry_run):
            print('   ' + line)


if __name__ == '__main__':
    main(sys.argv[1:])
