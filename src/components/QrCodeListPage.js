// ▼ useState をインポート
import React, { useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';

// --- (新規追加) ---
// QRコードカード（患者ごとに1枚、両面印刷対応）
// App.js の InpatientQrCodePage のレイアウトをベースに、患者マスタ用に変更
const PatientQrCodeCard = ({ patient }) => {
    const qrSize = 112; // 3cm ≒ 112px
    const value = patient.patientId;

    return (
        // w-[10cm] h-[7.5cm] のサイズを指定
        <div className="w-[10cm] h-[7.5cm] border border-gray-400 bg-white rounded-lg p-4 flex flex-row justify-center items-center break-inside-avoid">
            
            {/* 左半分 */}
            <div className="flex-1 flex flex-col items-center justify-center h-full text-center">
                <h3 className="text-lg font-bold mb-1">{patient.name} 様</h3>
                {/* 画面上では非表示(hidden)、印刷時のみ表示(print:block) */}
                <p className="text-sm mb-2 hidden print:block">ID: {patient.patientId}</p>
                <QRCodeSVG value={value} size={qrSize} />
            </div>

            {/* 中央の「縦」の山折り線 */}
            <div className="h-full border-l-2 border-dashed border-gray-400 mx-2"></div>

            {/* 右半分 */}
            <div className="flex-1 flex flex-col items-center justify-center h-full text-center">
                <h3 className="text-lg font-bold mb-1">{patient.name} 様</h3>
                {/* 画面上では非表示(hidden)、印刷時のみ表示(print:block) */}
                <p className="text-sm mb-2 hidden print:block">ID: {patient.patientId}</p>
                <QRCodeSVG value={value} size={qrSize} />
            </div>
        </div>
    );
};

// このコンポーネントは、患者リスト(patients)と戻るボタンの関数(onBack)を受け取ります
const QrCodeListPage = ({ patients, onBack }) => {
  // 選択された患者のIDを管理するためのstate
  const [selectedIds, setSelectedIds] = useState([]);
  // ★ 追加: 検索キーワードを管理するstate
  const [searchTerm, setSearchTerm] = useState('');

  // チェックボックスが変更されたときの処理
  const handleSelectionChange = (patientId) => {
    setSelectedIds(prevSelectedIds => {
      // 既に選択されていたら解除、されていなければ追加
      if (prevSelectedIds.includes(patientId)) {
        return prevSelectedIds.filter(id => id !== patientId);
      } else {
        return [...prevSelectedIds, patientId];
      }
    });
  };

  // ★ 修正: 表示対象の患者リストを検索ワードでフィルタリング
  const filteredPatients = patients.filter(patient => {
    if (!searchTerm) return true; // 検索語がなければ全員表示
    const term = searchTerm.toLowerCase();
    return (
        (patient.name && patient.name.toLowerCase().includes(term)) ||
        (patient.patientId && patient.patientId.toLowerCase().includes(term)) ||
        (patient.furigana && patient.furigana.toLowerCase().includes(term))
    );
  });

  // 全選択/全解除の処理
  // ★ 修正: フィルタリングされている患者のみを対象にする
  const handleSelectAll = () => {
    const targetIds = filteredPatients.filter(p => p.patientId).map(p => p.id);
    // 現在の選択状態に、表示中の全IDを追加（重複排除）
    setSelectedIds(prev => [...new Set([...prev, ...targetIds])]);
  };

  const handleDeselectAll = () => {
    // ★ 修正: 表示中の患者のみ選択解除する（他の患者の選択は残す）
    const targetIds = filteredPatients.map(p => p.id);
    setSelectedIds(prev => prev.filter(id => !targetIds.includes(id)));
  };

  return (
    <div className="bg-gray-100 p-6 rounded-lg shadow-md">
      
      {/* --- 印刷用スタイル --- */}
      <style>
          {`
          @media print {
              body {
                  margin: 0;
                  padding: 0;
                  background-color: white !important;
              }
              /* 画面表示用のヘッダー(no-print)を非表示 */
              .no-print {
                  display: none !important;
              }
              /* 印刷ページ本体 */
              .print-content {
                  margin: 0 !important;
                  padding: 0 !important;
                  background-color: white !important;
                  box-shadow: none !important;
              }
              /* カードがページをまたがないようにする */
              .qr-card {
                  break-inside: avoid;
                  page-break-inside: avoid;
              }
              /* 2列組を維持 */
              .print-grid {
                  grid-template-columns: repeat(2, minmax(0, 1fr));
              }
              /* 選択されていない場合に印刷時に非表示にするクラス */
              .not-selected-for-print {
                  display: none !important;
              }
          }
          `}
      </style>
      
      {/* 印刷時には表示しないヘッダー部分 */}
      {/* ★ 修正: レイアウトを調整し、検索バーを追加 */}
      <div className="flex flex-col md:flex-row justify-between items-center mb-6 no-print bg-white p-4 rounded-lg shadow gap-4">
        <div className="w-full md:w-auto">
            <h2 className="text-2xl font-bold mb-2">患者QRコード一覧</h2>
            {/* ★ 追加: 検索入力フィールド */}
            <div className="relative">
                <span className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <svg className="h-5 w-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                </span>
                <input
                    type="search"
                    placeholder="名前、ID、ふりがなで検索..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-10 p-2 border border-gray-300 rounded-md w-full md:w-80 focus:outline-none focus:ring-2 focus:ring-blue-500 transition"
                />
            </div>
        </div>
        
        <div className="flex items-center space-x-2">
          <button title="表示中をすべて選択" onClick={handleSelectAll} className="p-3 rounded-lg bg-green-600 hover:bg-green-700 text-white transition">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </button>
          <button title="表示中をすべて解除" onClick={handleDeselectAll} className="p-3 rounded-lg bg-yellow-500 hover:bg-yellow-600 text-white transition">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </button>
          <button title="選択したものを印刷" onClick={() => window.print()} className="p-3 rounded-lg bg-blue-600 hover:bg-blue-700 text-white transition">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
            </svg>
          </button>
          <button title="管理画面に戻る" onClick={onBack} className="p-3 rounded-lg bg-gray-500 hover:bg-gray-600 text-white transition">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 15L3 9m0 0l6-6M3 9h12a6 6 0 010 12h-3" />
            </svg>
          </button>
        </div>
      </div>

      {/* QRコードのリスト */}
      <div className="print-content bg-white p-4 rounded-lg shadow-inner grid grid-cols-1 md:print-grid md:grid-cols-2 gap-4">
        {/* ★ 修正: filteredPatients を使用して描画 */}
        {filteredPatients.length > 0 ? (
            filteredPatients
            .sort((a, b) => a.bed.localeCompare(b.bed, undefined, { numeric: true })) // ベッド番号でソート
            .map(patient => (
                // patientIdが存在する場合のみQRコードを生成
                patient.patientId && (
                // 選択されていない場合に印刷時に非表示にする (not-selected-for-print)
                // 印刷時の改ページ禁止 (qr-card)
                <div 
                    key={patient.id} 
                    className={`qr-card relative ${!selectedIds.includes(patient.id) ? 'not-selected-for-print' : ''} flex justify-center`}
                >
                    {/* チェックボックスをカードの左上に配置 (no-print) */}
                    <input
                    type="checkbox"
                    checked={selectedIds.includes(patient.id)}
                    onChange={() => handleSelectionChange(patient.id)}
                    className="no-print absolute top-2 left-2 h-6 w-6 z-10 cursor-pointer" 
                    />
                    {/* カードコンポーネント */}
                    <PatientQrCodeCard patient={patient} />
                </div>
                )
            ))
        ) : (
            <p className="col-span-2 text-center text-gray-500 py-8">条件に一致する患者が見つかりません。</p>
        )}
      </div>
    </div>
  );
};

export default QrCodeListPage;