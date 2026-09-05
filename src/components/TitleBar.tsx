import React from 'react';

/**
 * 視窗標題列。只有兩件事：一條 32px 高、可以拖著搬視窗的列，以及對窗置中的名字。
 *
 * 縮小／放大／關閉三顆不在這裡——那是 Windows 自己畫在這一列右邊的（main.cjs 的
 * `titleBarOverlay`），這樣滑到放大鈕上還會跳出 Snap Layouts。它們的顏色不吃 CSS，
 * 換深淺主題時由 src/utils/appearance.ts 通知主程序重畫。
 */
export const TitleBar: React.FC = () => {
  return (
    <div className="titlebar">
      <span className="tt">六月幫你顧</span>
    </div>
  );
};
