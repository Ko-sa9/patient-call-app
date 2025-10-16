// ▼ useState をインポート
import React, { useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';

// このコンポーネントは、患者リスト(patients)と戻るボタンの関数(onBack)を受け取ります
const QrCodeListPage = ({ patients, onBack }) => {
  // 選択された患者のIDを管理するためのstateを追加
  const [selectedIds, setSelectedIds] = useState([]);

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

  // 全選択/全解除の処理
  const handleSelectAll = () => {
    // patientIdが存在する全ての患者IDを取得してstateにセット
    const allPatientIds = patients.filter(p => p.patientId).map(p => p.id);
    setSelectedIds(allPatientIds);
  };
  const handleDeselectAll = () => {
    setSelectedIds([]);
  };

  return (
    <div className="bg-white p-6 rounded-lg shadow-md">
      {/* 印刷時には表示しないヘッダー部分 */}
      <div className="flex justify-between items-center mb-6 no-print">
        <h2 className="text-2xl font-bold">患者QRコード一覧</h2>
        
        {/* ▼ ここからボタン部分を変更 ▼ */}
        <div className="flex items-center space-x-2">
          <button title="すべて選択" onClick={handleSelectAll} className="p-3 rounded-lg bg-green-600 hover:bg-green-700 text-white transition">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </button>
          <button title="すべて解除" onClick={handleDeselectAll} className="p-3 rounded-lg bg-yellow-500 hover:bg-yellow-600 text-white transition">
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
        {/* ▲ ここまで ▲ */}
      </div>

      {/* QRコードのリスト */}
      <div className="qr-list-container">
        {patients
          .sort((a, b) => a.bed.localeCompare(b.bed, undefined, { numeric: true })) // ベッド番号でソート
          .map(patient => (
            // patientIdが存在する場合のみQRコードを生成
            patient.patientId && (
              // ▼ 選択されていない場合に、印刷時に非表示にするためのクラスを動的に追加
              <div key={patient.id} className={`qr-patient-item ${!selectedIds.includes(patient.id) ? 'not-selected-for-print' : ''}`}>
                <div className="patient-header">
                  {/* ▼ チェックボックスを追加 */}
                  <input
                    type="checkbox"
                    checked={selectedIds.includes(patient.id)}
                    onChange={() => handleSelectionChange(patient.id)}
                    className="print-checkbox no-print" // 印刷時にはチェックボックス自体も非表示にする
                  />
                  <h3 className="patient-name">{patient.name} 様</h3>
                </div>
                <div className="qr-code-wrapper">
                  {/* 1つ目のQRコード */}
                  <div className="qr-code-box">
                    <QRCodeSVG value={patient.patientId} />
                    <span className="patient-id">{patient.patientId}</span>
                  </div>
                  {/* 2つ目のQRコード */}
                  <div className="qr-code-box">
                    <QRCodeSVG value={patient.patientId} />
                    <span className="patient-id">{patient.patientId}</span>
                  </div>
                </div>
              </div>
            )
        ))}
      </div>
    </div>
  );
};

export default QrCodeListPage;