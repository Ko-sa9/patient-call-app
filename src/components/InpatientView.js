// src/components/InpatientView.js

import React, { useState, useEffect, useContext } from 'react';
import { AppLayout, AppContext, db } from '../App'; // App.jsから主要コンポーネントと変数をインポート (パス確認)
import LayoutEditor from './LayoutEditor.js'; // レイアウトエディタをインポート

// --- ① 管理画面コンポーネント ---
const InpatientAdminPage = () => {
  const [isLayoutEditMode, setLayoutEditMode] = useState(false); // レイアウト編集モードかどうかの状態

  // レイアウト編集モードの表示
  if (isLayoutEditMode) {
    return <LayoutEditor onExit={() => setLayoutEditMode(false)} />;
  }

  // 通常の管理画面（クラークさん用モニター）の表示
  return (
    <div>
      {/* レイアウト編集ボタン */}
      <div className="bg-white p-6 rounded-lg shadow mb-6">
        <h3 className="text-xl font-semibold text-gray-800 border-b pb-3 mb-4">レイアウト設定</h3>
        <button
          onClick={() => setLayoutEditMode(true)} // クリックで編集モードに入る
          className="bg-purple-600 hover:bg-purple-700 text-white font-bold py-2 px-4 rounded-lg"
        >
          ベッド配置を編集する
        </button>
      </div>

      {/* クラークさん用モニター表示エリア（タスク7以降で実装） */}
      <div className="bg-white p-6 rounded-lg shadow">
        <h3 className="text-xl font-semibold text-gray-800">ベッド状況モニター</h3>
        <p>（タスク7：ここにレイアウトに基づいたベッド状況がリアルタイムで表示されます）</p>
        <p>（タスク8：ここでベッドの状態が「準備完了」になったら音声通知が鳴ります）</p>
        <p>（タスク10：ここでクラークさんが「連絡済」操作を行えるようにします）</p>
      </div>
    </div>
  );
};

// --- ② スタッフ画面コンポーネント ---
const InpatientStaffPage = () => {
  // ここにレイアウトデータを読み込み、ベッドボタンを表示・操作するロジックが入る
  // (タスク7以降で実装)

  return (
    <div>
      <h2 className="text-2xl font-bold mb-4">入院透析室 - スタッフ画面</h2>
      <p>（タスク7：ここにレイアウトに基づいたベッドボタンが表示されます）</p>
      <p>（タスク9：ここにQRスキャンボタンが追加されます）</p>
    </div>
  );
};


// --- ③ 親コンポーネント (タブ切り替え) ---
const InpatientView = ({ user, onGoBack }) => {
  const [currentPage, setCurrentPage] = useState('staff'); // 初期表示はスタッフ画面

  // ページ切り替えボタン
  const NavButton = ({ page, label }) => (
    <button
      onClick={() => setCurrentPage(page)}
      className={`px-3 py-2 sm:px-4 rounded-lg font-medium transition duration-200 text-sm sm:text-base ${
        currentPage === page
          ? 'bg-blue-600 text-white shadow-md'
          : 'bg-white text-gray-700 hover:bg-gray-200'
      }`}
    >
      {label}
    </button>
  );

  // 現在のページに応じてコンポーネントをレンダリング
  const renderPage = () => {
    switch (currentPage) {
      case 'admin':
        return <InpatientAdminPage />;
      case 'staff':
        return <InpatientStaffPage />;
      default:
        return <InpatientStaffPage />;
    }
  };

  // AppLayout を使って全体のレイアウトを構成
  return (
    <AppLayout
      user={user}
      onGoBack={onGoBack}
      hideCoolSelector={true} // 入院透析室ではクール選択を非表示
      navButtons={
        <>
          <NavButton page="staff" label="スタッフ" />
          <NavButton page="admin" label="管理" />
        </>
      }
    >
      {renderPage()}
    </AppLayout>
  );
};

export default InpatientView; // この親コンポーネントをエクスポート