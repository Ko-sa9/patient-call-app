import React from 'react';
import { useDrag } from 'react-dnd';

// ドラッグするアイテムの種類を定義 (識別子として使う)
export const ItemTypes = {
  BED: 'bed',
};

// ドラッグ可能なベッドボタンコンポーネント
const BedButton = ({ bedNumber, left, top }) => {
  // useDragフックを設定
  const [{ isDragging }, drag] = useDrag(() => ({
    type: ItemTypes.BED, // アイテムの種類を設定
    item: { bedNumber, left, top }, // ドラッグ中に渡す情報 (現在のベッド番号と位置)
    collect: (monitor) => ({
      isDragging: !!monitor.isDragging(), // ドラッグ中かどうかのフラグ
    }),
  }));

  return (
    // ref={drag} で、このdiv要素をドラッグ可能にする
    <div
      ref={drag}
      className={`absolute p-2 bg-blue-500 text-white rounded shadow cursor-grab ${isDragging ? 'opacity-50' : 'opacity-100'}`} // ドラッグ中は半透明にする
      style={{
        left: `${left}px`,
        top: `${top}px`,
        touchAction: 'none' // スマホでのドラッグ用
      }}
    >
      {bedNumber}
    </div>
  );
};

export default BedButton;