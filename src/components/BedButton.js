import React from 'react';
import { useDrag } from 'react-dnd';

// ドラッグするアイテムの種類を定義します（アプリ内でユニークな文字列なら何でもOKです）
export const ItemTypes = {
  BED: 'bed',
};

// ドラッグ可能なベッドボタンのコンポーネント
const BedButton = ({ bedNumber, left, top }) => {
  // react-dnd の useDrag フックを設定します
  const [{ isDragging }, drag] = useDrag(() => ({
    type: ItemTypes.BED, // 1. このアイテムの種類（BED）を定義
    item: { bedNumber, left, top }, // 2. ドラッグ開始時に渡す情報（ベッド番号と元の位置）
    collect: (monitor) => ({
      isDragging: !!monitor.isDragging(), // 3. ドラッグ中かどうかの状態を取得
    }),
  }));

  return (
    // 4. ref={drag} を設定した要素がドラッグ可能になります
    <div
      ref={drag}
      className={`absolute p-2 bg-blue-500 text-white rounded shadow cursor-grab ${isDragging ? 'opacity-50' : 'opacity-100'}`} // ドラッグ中は半透明に
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
