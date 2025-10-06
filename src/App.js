import React, { useState, useEffect, createContext, useContext, useRef, useCallback } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, collection, doc, onSnapshot, query, where, addDoc, getDocs, deleteDoc, updateDoc, serverTimestamp, writeBatch } from 'firebase/firestore';
import { getFunctions } from 'firebase/functions';
import { Html5Qrcode } from 'html5-qrcode';
import * as wanakana from 'wanakana';

// --- Firebase Configuration ---
const firebaseConfig = {
  apiKey: process.env.REACT_APP_FIREBASE_API_KEY, // Netlifyの環境変数から安全に読み込み
  authDomain: "patient-call-app-f5e7f.firebaseapp.com",
  projectId: "patient-call-app-f5e7f",
  storageBucket: "patient-call-app-f5e7f.appspot.com",
  messagingSenderId: "545799005149",
  appId: "1:545799005149:web:f1b22a42040eb455e98c34"
};

// --- Initialize Firebase ---
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const functions = getFunctions(app, 'us-central1'); // Cloud Functionのリージョンを明示的に指定

// --- Helper Components & Functions ---
const getTodayString = () => {
    const today = new Date();
    today.setHours(today.getHours() + 9); // JST
    return today.toISOString().split('T')[0];
}

const getDayQueryString = (dateString) => {
    const date = new Date(dateString);
    const dayIndex = date.getDay();
    if ([1, 3, 5].includes(dayIndex)) return '月水金';
    if ([2, 4, 6].includes(dayIndex)) return '火木土';
    return null;
};

const LoadingSpinner = ({ text = "読み込み中..." }) => (
    <div className="flex flex-col justify-center items-center h-full my-8"><div className="animate-spin rounded-full h-12 w-12 border-t-4 border-b-4 border-blue-500"></div><p className="mt-4 text-gray-600">{text}</p></div>
);

const CustomModal = ({ title, children, onClose, footer }) => (
    <div className="fixed inset-0 bg-black bg-opacity-60 flex justify-center items-center z-50 p-4"><div className="bg-white p-6 rounded-lg shadow-xl w-full max-w-lg"><div className="flex justify-between items-center border-b pb-3 mb-4"><h3 className="text-xl font-bold">{title}</h3>{onClose && <button onClick={onClose} className="text-gray-500 hover:text-gray-800 text-2xl">&times;</button>}</div><div className="mb-6">{children}</div>{footer && <div className="border-t pt-4 flex justify-end space-x-3">{footer}</div>}</div></div>
);

const ConfirmationModal = ({ title, message, onConfirm, onCancel, confirmText = "実行", confirmColor = "blue" }) => (
     <CustomModal title={title} onClose={onCancel} footer={<><button onClick={onCancel} className="bg-gray-300 hover:bg-gray-400 text-gray-800 font-bold py-2 px-6 rounded-lg">キャンセル</button><button onClick={onConfirm} className={`font-bold py-2 px-6 rounded-lg transition text-white ${confirmColor === 'red' ? 'bg-red-600 hover:bg-red-700' : 'bg-blue-600 hover:bg-blue-700'}`}>{confirmText}</button></>}><p>{message}</p></CustomModal>
);

// --- App Context for Shared State ---
const AppContext = createContext();
const FACILITIES = ["本院透析室", "坂田透析棟", "じんクリニック", "木更津クリニック"];

// --- Custom Hooks ---
const useDailyList = () => {
    const { selectedFacility, selectedDate, selectedCool } = useContext(AppContext);
    const [dailyList, setDailyList] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!selectedFacility || !selectedDate || !selectedCool) {
            setLoading(false);
            return;
        }
        setLoading(true);
        const dailyListId = `${selectedDate}_${selectedFacility}_${selectedCool}`;
        const dailyPatientsCollectionRef = collection(db, 'daily_lists', dailyListId, 'patients');
        
        const q = query(dailyPatientsCollectionRef);

        const unsubscribe = onSnapshot(q, (snapshot) => {
            const fetchedDailyPatients = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data(), cool: selectedCool }));
            setDailyList(fetchedDailyPatients);
            setLoading(false);
        }, (err) => {
            console.error("Daily list fetch error:", err);
            setLoading(false);
        });
        
        return () => unsubscribe();
    }, [selectedFacility, selectedDate, selectedCool]);

    return { dailyList, loading };
};

const useAllDayPatients = () => {
    const { selectedFacility, selectedDate } = useContext(AppContext);
    const [allPatients, setAllPatients] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!selectedFacility || !selectedDate) {
            setLoading(false);
            return;
        }
        setLoading(true);

        const cools = ['1', '2', '3'];
        const unsubscribes = [];
        let patientData = { '1': [], '2': [], '3': [] };
        let loadedFlags = { '1': false, '2': false, '3': false };

        const updateCombinedList = () => {
            const combined = Object.values(patientData).flat();
            setAllPatients(combined);
        };
        
        const checkLoadingDone = () => {
            if (Object.values(loadedFlags).every(flag => flag)) {
                setLoading(false);
            }
        };

        cools.forEach(cool => {
            const dailyListId = `${selectedDate}_${selectedFacility}_${cool}`;
            const dailyPatientsCollectionRef = collection(db, 'daily_lists', dailyListId, 'patients');
            const q = query(dailyPatientsCollectionRef);

            const unsubscribe = onSnapshot(q, (snapshot) => {
                patientData[cool] = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data(), cool: cool }));
                updateCombinedList();
                if (!loadedFlags[cool]) {
                    loadedFlags[cool] = true;
                    checkLoadingDone();
                }
            }, (err) => {
                console.error(`Error fetching list for cool ${cool}:`, err);
                patientData[cool] = [];
                updateCombinedList();
                 if (!loadedFlags[cool]) {
                    loadedFlags[cool] = true;
                    checkLoadingDone();
                }
            });
            unsubscribes.push(unsubscribe);
        });

        return () => {
            unsubscribes.forEach(unsub => unsub());
        };
    }, [selectedFacility, selectedDate]);

    return { allPatients, loading };
};

// --- Status Update Function ---
const updatePatientStatus = async (facility, date, cool, patientId, newStatus) => {
    const dailyListId = `${date}_${facility}_${cool}`;
    const patientDocRef = doc(db, 'daily_lists', dailyListId, 'patients', patientId);
    try {
        await updateDoc(patientDocRef, {
            status: newStatus,
            updatedAt: serverTimestamp()
        });
    } catch (error) {
        console.error("Error updating status: ", error);
        alert("ステータスの更新に失敗しました。");
    }
};

const StatusBadge = ({ status }) => {
    const statusStyles = {
        '治療中': 'bg-green-200 text-green-800',
        '呼出中': 'bg-blue-200 text-blue-800',
        '退出済': 'bg-gray-500 text-white',
    };
    return <span className={`text-xs font-semibold mr-2 px-2.5 py-0.5 rounded-full ${statusStyles[status] || 'bg-gray-200'}`}>{status}</span>;
};


// --- Page Components ---

// --- 1. Admin Page ---
const AdminPage = () => {
    const { selectedFacility, selectedDate, selectedCool } = useContext(AppContext);
    const { dailyList, loading: loadingDaily } = useDailyList();

    const [masterPatients, setMasterPatients] = useState([]);
    const [loadingMaster, setLoadingMaster] = useState(true);
    const [masterModalOpen, setMasterModalOpen] = useState(false);
    const [editingMasterPatient, setEditingMasterPatient] = useState(null);
    
    const initialMasterFormData = { patientId: '', lastName: '', firstName: '', furigana: '', bed: '', day: '月水金', cool: '1' };
    const [masterFormData, setMasterFormData] = useState(initialMasterFormData);
    
    const [furiganaParts, setFuriganaParts] = useState({ last: '', first: '' });
    
    // --- ▼ 手動編集を管理するための ref ---
    const isFuriganaManuallyEdited = useRef(false);
    // --- ここまで ---
    
    const [masterSearchTerm, setMasterSearchTerm] = useState('');
    
    const [dailyModalOpen, setDailyModalOpen] = useState(false);
    const [editingDailyPatient, setEditingDailyPatient] = useState(null);
    const [dailyFormData, setDailyFormData] = useState({ name: '', bed: '', furigana: ''});

    const [confirmMasterDelete, setConfirmMasterDelete] = useState({ isOpen: false, patientId: null });
    const [confirmDailyDelete, setConfirmDailyDelete] = useState({ isOpen: false, patientId: null });
    const [confirmLoadModal, setConfirmLoadModal] = useState({isOpen: false, onConfirm: () => {}});
    const [confirmClearListModal, setConfirmClearListModal] = useState({ isOpen: false });

    const masterPatientsCollectionRef = collection(db, 'patients');
    const dailyPatientsCollectionRef = (cool) => collection(db, 'daily_lists', `${selectedDate}_${selectedFacility}_${cool}`, 'patients');

    useEffect(() => {
        setLoadingMaster(true);
        const q = query(masterPatientsCollectionRef, where("facility", "==", selectedFacility));
        const unsubscribe = onSnapshot(q, (snapshot) => {
            const patientsData = snapshot.docs.map(doc => {
                const data = doc.data();
                let lastName = data.lastName || '';
                let firstName = data.firstName || '';
                let name = '';

                if (lastName || firstName) {
                    name = `${lastName} ${firstName}`.trim();
                } else if (data.name) {
                    name = data.name;
                    const nameParts = data.name.split(/[\s　]+/);
                    lastName = nameParts[0] || '';
                    firstName = nameParts.slice(1).join(' ') || '';
                }

                return { 
                    id: doc.id, 
                    ...data,
                    name,
                    lastName,
                    firstName,
                };
            });
            setMasterPatients(patientsData);
            setLoadingMaster(false);
        }, (err) => {
            console.error("Master patient fetch error:", err);
            setLoadingMaster(false);
        });
        return () => unsubscribe();
    }, [selectedFacility]);
    
    useEffect(() => {
        // 手動編集中は、自動結合を停止
        if (isFuriganaManuallyEdited.current) return;
        
        setMasterFormData(prev => ({
            ...prev,
            furigana: `${furiganaParts.last}${furiganaParts.first}`
        }));
    }, [furiganaParts]);

    const handleOpenMasterModal = (patient = null) => {
        setEditingMasterPatient(patient);
        isFuriganaManuallyEdited.current = false; // 手動編集フラグをリセット

        if (patient) {
            setMasterFormData({ 
                patientId: patient.patientId || '', 
                lastName: patient.lastName || '',
                firstName: patient.firstName || '',
                furigana: patient.furigana || '', 
                bed: patient.bed, 
                day: patient.day, 
                cool: patient.cool 
            });
            // 編集時は、既存のふりがなを手動編集用にセット
            if(patient.furigana) {
                 isFuriganaManuallyEdited.current = true;
            }
            setFuriganaParts({ last: '', first: '' });

        } else {
            setMasterFormData(initialMasterFormData);
            setFuriganaParts({ last: '', first: '' });
        }
        setMasterModalOpen(true);
    };
    
    const handleCloseMasterModal = () => { setMasterModalOpen(false); setEditingMasterPatient(null); };
    
    const handleMasterFormChange = (e) => {
        const { name, value } = e.target;

        // 手動でふりがなを編集した場合
        if (name === 'furigana') {
            isFuriganaManuallyEdited.current = true; // 手動編集フラグを立てる
            setMasterFormData(prev => ({ ...prev, furigana: value }));
            return; // ここで処理を終了
        }

        // 姓・名の入力値をメインのstateに反映
        setMasterFormData(prev => ({ ...prev, [name]: value }));

        // 手動編集モードでなければ、自動入力を試みる
        if (!isFuriganaManuallyEdited.current) {
            if (name === 'lastName') {
                 // isKanaでひらがな・カタカナ両方の入力を受け付ける
                if (wanakana.isKana(value)) {
                    // toHiraganaでひらがなを出力
                    setFuriganaParts(prev => ({ ...prev, last: wanakana.toHiragana(value) }));
                }
            } else if (name === 'firstName') {
                if (wanakana.isKana(value)) {
                    setFuriganaParts(prev => ({ ...prev, first: wanakana.toHiragana(value) }));
                }
            }
        }
    };

    const handleMasterSubmit = async (e) => { 
        e.preventDefault(); 
        if (!masterFormData.lastName || !masterFormData.firstName || !masterFormData.bed || !masterFormData.patientId) return; 
        
        const dataToSave = {
            patientId: masterFormData.patientId,
            lastName: masterFormData.lastName,
            firstName: masterFormData.firstName,
            furigana: masterFormData.furigana,
            bed: masterFormData.bed,
            day: masterFormData.day,
            cool: masterFormData.cool,
            facility: selectedFacility,
        };

        try { 
            if (editingMasterPatient) { 
                await updateDoc(doc(masterPatientsCollectionRef, editingMasterPatient.id), { ...dataToSave, updatedAt: serverTimestamp() }); 
            } else { 
                await addDoc(masterPatientsCollectionRef, { ...dataToSave, createdAt: serverTimestamp() }); 
            } 
            handleCloseMasterModal(); 
        } catch (error) { 
            console.error("Error saving master patient:", error); 
        } 
    };

    // (handleDeleteMasterClick 以降の関数は変更ありません)
    const handleDeleteMasterClick = (patientId) => setConfirmMasterDelete({ isOpen: true, patientId });
    const handleConfirmMasterDelete = async () => { if (confirmMasterDelete.patientId) { try { await deleteDoc(doc(masterPatientsCollectionRef, confirmMasterDelete.patientId)); } catch (error) { console.error("Error deleting master patient:", error); } setConfirmMasterDelete({ isOpen: false, patientId: null }); } };
    const handleOpenDailyModal = (patient = null) => {
        setEditingDailyPatient(patient);
        setDailyFormData(patient ? { name: patient.name, bed: patient.bed, furigana: patient.furigana || '' } : { name: '', bed: '', furigana: '' });
        setDailyModalOpen(true);
    };
    const handleCloseDailyModal = () => { setDailyModalOpen(false); setEditingDailyPatient(null); };
    const handleDailyFormChange = (e) => setDailyFormData(prev => ({ ...prev, [e.target.name]: e.target.value }));
    const handleDailySubmit = async (e) => {
        e.preventDefault();
        if (!dailyFormData.name || !dailyFormData.bed) return;
        try {
            const targetCollection = dailyPatientsCollectionRef(selectedCool);
            if (editingDailyPatient) {
                await updateDoc(doc(targetCollection, editingDailyPatient.id), { name: dailyFormData.name, bed: dailyFormData.bed, furigana: dailyFormData.furigana, updatedAt: serverTimestamp() });
            } else {
                await addDoc(targetCollection, { ...dailyFormData, status: '治療中', isTemporary: true, createdAt: serverTimestamp() });
            }
            handleCloseDailyModal();
        } catch (error) { console.error("Error saving daily patient:", error); }
    };
    const handleDeleteDailyClick = (patientId) => setConfirmDailyDelete({ isOpen: true, patientId });
    const handleConfirmDailyDelete = async () => { if (confirmDailyDelete.patientId) { try { await deleteDoc(doc(dailyPatientsCollectionRef(selectedCool), confirmDailyDelete.patientId)); } catch (error) { console.error("Error deleting daily patient:", error); } setConfirmDailyDelete({ isOpen: false, patientId: null }); } };
    const handleLoadPatients = async () => {
        const dayQuery = getDayQueryString(selectedDate);
        if (!dayQuery) { alert("日曜日は対象外です。"); return; }
        const loadAction = async () => {
            setLoadingMaster(true);
            try {
                const q = query(masterPatientsCollectionRef, where("facility", "==", selectedFacility), where("day", "==", dayQuery), where("cool", "==", selectedCool));
                const masterSnapshot = await getDocs(q);
                if (masterSnapshot.empty) { alert("対象となる患者さんがマスタに登録されていません。"); setLoadingMaster(false); return; }
                const batch = writeBatch(db);
                const dailyListId = `${selectedDate}_${selectedFacility}_${selectedCool}`;
                const listDocRef = doc(db, 'daily_lists', dailyListId);
                batch.set(listDocRef, { createdAt: serverTimestamp(), facility: selectedFacility, date: selectedDate, cool: selectedCool });
                masterSnapshot.forEach(patientDoc => {
                    const patientData = patientDoc.data();
                    const patientName = `${patientData.lastName || ''} ${patientData.firstName || ''}`.trim() || patientData.name || '';
                    const newDailyPatientDocRef = doc(dailyPatientsCollectionRef(selectedCool)); 
                    batch.set(newDailyPatientDocRef, { 
                        name: patientName, 
                        furigana: patientData.furigana || '', 
                        bed: patientData.bed, 
                        status: '治療中', 
                        masterPatientId: patientData.patientId || null,
                        createdAt: serverTimestamp() 
                    });
                });
                await batch.commit();
            } catch (error) { console.error("Error loading daily patients:", error); alert("読み込みに失敗しました。"); }
            finally { setLoadingMaster(false); setConfirmLoadModal({ isOpen: false, onConfirm: () => {} }); }
        };
        if (dailyList.length > 0) { setConfirmLoadModal({ isOpen: true, onConfirm: loadAction }); } else { loadAction(); }
    };
    const handleClearDailyList = async () => {
        if (dailyList.length === 0) {
            alert("リストは既に空です。");
            setConfirmClearListModal({ isOpen: false });
            return;
        }
        try {
            const batch = writeBatch(db);
            dailyList.forEach(patient => {
                const docRef = doc(dailyPatientsCollectionRef(selectedCool), patient.id);
                batch.delete(docRef);
            });
            await batch.commit();
        } catch (error) {
            console.error("Error clearing daily list:", error);
            alert("リストの削除に失敗しました。");
        } finally {
            setConfirmClearListModal({ isOpen: false });
        }
    };
    
    return (
        <div className="space-y-8">
            {masterModalOpen && <CustomModal title={editingMasterPatient ? "患者情報の編集" : "新規患者登録"} onClose={handleCloseMasterModal} footer={<><button onClick={handleCloseMasterModal} className="bg-gray-300 hover:bg-gray-400 text-gray-800 font-bold py-2 px-6 rounded-lg">キャンセル</button><button onClick={handleMasterSubmit} className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-6 rounded-lg">保存</button></>}><form onSubmit={handleMasterSubmit} className="space-y-4">
                <div>
                    <label className="block font-medium mb-1">患者ID (QRコード用)</label>
                    <input type="text" name="patientId" value={masterFormData.patientId} onChange={handleMasterFormChange} className="w-full p-2 border rounded-md" placeholder="電子カルテIDなどを入力" required />
                </div>
                <div><label className="block font-medium mb-1">曜日</label><select name="day" value={masterFormData.day} onChange={handleMasterFormChange} className="w-full p-2 border rounded-md"><option value="月水金">月水金</option><option value="火木土">火木土</option></select></div>
                <div><label className="block font-medium mb-1">クール</label><select name="cool" value={masterFormData.cool} onChange={handleMasterFormChange} className="w-full p-2 border rounded-md"><option value="1">1</option><option value="2">2</option><option value="3">3</option></select></div>
                <div><label className="block font-medium mb-1">ベッド番号</label><input type="text" name="bed" value={masterFormData.bed} onChange={handleMasterFormChange} className="w-full p-2 border rounded-md" required /></div>
                
                <div className="grid grid-cols-2 gap-4">
                    <div>
                        <label className="block font-medium mb-1">姓</label>
                        <input type="text" name="lastName" value={masterFormData.lastName} onChange={handleMasterFormChange} className="w-full p-2 border rounded-md" placeholder="例：やまだ" required />
                    </div>
                    <div>
                        <label className="block font-medium mb-1">名</label>
                        <input type="text" name="firstName" value={masterFormData.firstName} onChange={handleMasterFormChange} className="w-full p-2 border rounded-md" placeholder="例：たろう" required />
                    </div>
                </div>
                
                <div>
                    <label className="block font-medium mb-1">ふりがな (ひらがな)</label>
                    {/* ▼ readOnlyを削除し、手動編集可能に */}
                    <input 
                        type="text" 
                        name="furigana" 
                        value={masterFormData.furigana} 
                        onChange={handleMasterFormChange} 
                        className="w-full p-2 border rounded-md" 
                        placeholder="自動入力されます"
                    />
                </div>
            </form></CustomModal>}

            {/* ( dailyModalOpen以降のJSXは変更ありません ) */}
            {dailyModalOpen && <CustomModal title={editingDailyPatient ? "臨時情報の編集" : "臨時患者の追加"} onClose={handleCloseDailyModal} footer={<><button onClick={handleCloseDailyModal} className="bg-gray-300 hover:bg-gray-400 text-gray-800 font-bold py-2 px-6 rounded-lg">キャンセル</button><button onClick={handleDailySubmit} className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-6 rounded-lg">保存</button></>}><form onSubmit={handleDailySubmit} className="space-y-4"><div><label className="block font-medium mb-1">ベッド番号</label><input type="text" name="bed" value={dailyFormData.bed} onChange={handleDailyFormChange} className="w-full p-2 border rounded-md" required /></div><div><label className="block font-medium mb-1">氏名</label><input type="text" name="name" value={dailyFormData.name} onChange={handleDailyFormChange} className="w-full p-2 border rounded-md" required /></div><div><label className="block font-medium mb-1">ふりがな</label><input type="text" name="furigana" value={dailyFormData.furigana} onChange={handleDailyFormChange} className="w-full p-2 border rounded-md" placeholder="例：りんじ たろう"/></div></form></CustomModal>}
            {confirmMasterDelete.isOpen && <ConfirmationModal title="マスタから削除" message="この患者情報をマスタから完全に削除しますか？" onConfirm={handleConfirmMasterDelete} onCancel={() => setConfirmMasterDelete({ isOpen: false, patientId: null })} confirmText="削除" confirmColor="red" />}
            {confirmDailyDelete.isOpen && <ConfirmationModal title="リストから削除" message="この患者を本日のリストから削除しますか？マスタ登録は残ります。" onConfirm={handleConfirmDailyDelete} onCancel={() => setConfirmDailyDelete({ isOpen: false, patientId: null })} confirmText="削除" confirmColor="red" />}
            {confirmLoadModal.isOpen && <ConfirmationModal title="読み込みの確認" message="既にリストが存在します。上書きしてマスタから再読み込みしますか？" onConfirm={confirmLoadModal.onConfirm} onCancel={() => setConfirmLoadModal({ isOpen: false, onConfirm: () => {} })} confirmText="再読み込み" confirmColor="blue" />}
            {confirmClearListModal.isOpen && <ConfirmationModal title="リストの一括削除" message={`【${selectedFacility} | ${selectedDate} | ${selectedCool}クール】のリストを完全に削除します。よろしいですか？`} onConfirm={handleClearDailyList} onCancel={() => setConfirmClearListModal({ isOpen: false })} confirmText="一括削除" confirmColor="red" />}
            <div className="bg-white p-6 rounded-lg shadow-md">
                <h3 className="text-xl font-semibold text-gray-800 border-b pb-3 mb-4">本日の呼び出しリスト作成</h3>
                <p className="text-gray-600 mb-4">グローバル設定（画面上部）で施設・日付・クールを選択し、下のボタンで対象患者を読み込みます。</p>
                <button onClick={handleLoadPatients} className="w-full md:w-auto bg-green-500 hover:bg-green-600 text-white font-bold py-3 px-6 rounded-lg transition">対象患者を読み込み</button>
            </div>
            <div className="bg-white p-6 rounded-lg shadow">
                 <div className="flex justify-between items-center mb-4 border-b pb-2">
                    <h3 className="text-xl font-semibold text-gray-800">リスト ({selectedCool}クール)</h3>
                    <div className="flex items-center space-x-2">
                        <button title="臨時追加" onClick={() => handleOpenDailyModal(null)} className="flex items-center space-x-2 bg-orange-500 hover:bg-orange-600 text-white font-bold py-2 px-3 rounded-lg transition text-sm">
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" /></svg>
                        </button>
                        <button title="リストから全削除" onClick={() => setConfirmClearListModal({ isOpen: true })} disabled={dailyList.length === 0} className="flex items-center space-x-2 bg-red-600 hover:bg-red-700 text-white font-bold py-2 px-3 rounded-lg transition disabled:bg-red-300 disabled:cursor-not-allowed text-sm">
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                        </button>
                    </div>
                 </div>
                 {loadingDaily ? <LoadingSpinner /> : ( dailyList.length > 0 ? ( 
                 <div className="overflow-x-auto">
                    <table className="min-w-full bg-white">
                        <thead className="bg-gray-100">
                            <tr>
                                <th className="p-2 text-left text-sm font-semibold whitespace-nowrap">操作</th>
                                <th className="p-2 text-left text-sm font-semibold whitespace-nowrap">状態</th>
                                <th className="p-2 text-left text-sm font-semibold whitespace-nowrap">ベッド番号</th>
                                <th className="p-2 text-left text-sm font-semibold whitespace-nowrap">氏名</th>
                                <th className="p-2 text-left text-sm font-semibold whitespace-nowrap">ふりがな</th>
                            </tr>
                        </thead>
                        <tbody>
                            {dailyList.sort((a, b) => a.bed.localeCompare(b.bed, undefined, {numeric: true})).map(p => (
                                <tr key={p.id} className="border-b hover:bg-gray-50">
                                    <td className="p-2">
                                        <div className="flex space-x-2">
                                            {p.status === '治療中' && <button title="呼出" onClick={() => updatePatientStatus(selectedFacility, selectedDate, selectedCool, p.id, '呼出中')} className="p-2 rounded bg-blue-500 hover:bg-blue-600 text-white"><svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" /></svg></button>}
                                            {p.status === '呼出中' && <>
                                                <button title="退出" onClick={() => updatePatientStatus(selectedFacility, selectedDate, selectedCool, p.id, '退出済')} className="p-2 rounded bg-purple-500 hover:bg-purple-600 text-white"><svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" /></svg></button>
                                                <button title="キャンセル" onClick={() => updatePatientStatus(selectedFacility, selectedDate, selectedCool, p.id, '治療中')} className="p-2 rounded bg-gray-500 hover:bg-gray-600 text-white"><svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 10h10a8 8 0 018 8v2M3 10l6-6m-6 6l6 6" /></svg></button>
                                            </>}
                                            {p.status === '退出済' && <button title="治療中に戻す" onClick={() => updatePatientStatus(selectedFacility, selectedDate, selectedCool, p.id, '治療中')} className="p-2 rounded bg-green-500 hover:bg-green-600 text-white"><svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h5M20 20v-5h-5" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 9a9 9 0 0114.13-4.13M20 15a9 9 0 01-14.13 4.13" /></svg></button>}
                                            <button title="編集" onClick={() => handleOpenDailyModal(p)} className="p-2 rounded bg-yellow-500 hover:bg-yellow-600 text-white"><svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg></button>
                                            <button title="削除" onClick={() => handleDeleteDailyClick(p.id)} className="p-2 rounded bg-red-500 hover:bg-red-600 text-white"><svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg></button>
                                        </div>
                                    </td>
                                    <td className="p-2 text-sm whitespace-nowrap"><StatusBadge status={p.status} /></td>
                                    <td className="p-2 text-sm whitespace-nowrap">{p.bed}</td>
                                    <td className="p-2 text-sm whitespace-nowrap">{p.name}{p.isTemporary && <span className="ml-2 text-xs bg-orange-200 text-orange-800 px-2 py-0.5 rounded-full">臨時</span>}</td>
                                    <td className="p-2 text-sm whitespace-nowrap">{p.furigana}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
                ) : <p className="text-center py-8 text-gray-500">リストが空です。上記ボタンから患者を読み込んでください。</p>)}
            </div>
            <div className="bg-white p-6 rounded-lg shadow">
                <div className="flex justify-between items-center mb-4 border-b pb-2">
                    <h3 className="text-xl font-semibold text-gray-800">通常患者マスタ</h3>
                    <div className="flex items-center space-x-2">
                        <input 
                            type="search" 
                            placeholder="氏名, ふりがな, ベッド番号で検索" 
                            value={masterSearchTerm}
                            onChange={(e) => setMasterSearchTerm(e.target.value)}
                            className="p-2 border rounded-md text-sm"
                        />
                        <button title="患者マスタ追加" onClick={() => handleOpenMasterModal()} className="flex items-center space-x-2 bg-blue-500 hover:bg-blue-600 text-white font-bold py-2 px-3 rounded-lg transition text-sm">
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" /></svg>
                        </button>
                    </div>
                </div>
                {loadingMaster ? <LoadingSpinner /> : (
                    <div className="overflow-x-auto">
                        <table className="min-w-full bg-white">
                            <thead className="bg-gray-100">
                                <tr>
                                    <th className="p-2 text-left text-sm font-semibold whitespace-nowrap">操作</th>
                                    <th className="p-2 text-left text-sm font-semibold whitespace-nowrap">曜日</th>
                                    <th className="p-2 text-left text-sm font-semibold whitespace-nowrap">クール</th>
                                    <th className="p-2 text-left text-sm font-semibold whitespace-nowrap">ベッド番号</th>
                                    <th className="p-2 text-left text-sm font-semibold whitespace-nowrap">氏名</th>
                                    <th className="p-2 text-left text-sm font-semibold whitespace-nowrap">ふりがな</th>
                                </tr>
                            </thead>
                            <tbody>
                                {masterPatients.length > 0 ? 
                                    masterPatients
                                    .filter(p => {
                                        const term = masterSearchTerm.toLowerCase();
                                        if (!term) return true;
                                        return (p.name && p.name.toLowerCase().includes(term)) || 
                                               (p.furigana && p.furigana.toLowerCase().includes(term)) ||
                                               (p.bed && p.bed.toLowerCase().includes(term));
                                    })
                                    .sort((a, b) => {
                                        const dayOrder = { '月水金': 1, '火木土': 2 };
                                        const dayCompare = (dayOrder[a.day] || 99) - (dayOrder[b.day] || 99);
                                        if (dayCompare !== 0) return dayCompare;
                                        const coolCompare = a.cool.localeCompare(b.cool, undefined, { numeric: true });
                                        if (coolCompare !== 0) return coolCompare;
                                        return a.bed.localeCompare(b.bed, undefined, { numeric: true });
                                    }).map(p => (
                                        <tr key={p.id} className="border-b hover:bg-gray-50">
                                            <td className="p-2">
                                                <div className="flex space-x-2">
                                                    <button title="編集" onClick={() => handleOpenMasterModal(p)} className="p-2 rounded bg-yellow-500 hover:bg-yellow-600 text-white"><svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg></button>
                                                    <button title="削除" onClick={() => handleDeleteMasterClick(p.id)} className="p-2 rounded bg-red-500 hover:bg-red-600 text-white"><svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg></button>
                                                </div>
                                            </td>
                                            <td className="p-2 text-sm whitespace-nowrap">{p.day}</td>
                                            <td className="p-2 text-sm whitespace-nowrap">{p.cool}</td>
                                            <td className="p-2 text-sm whitespace-nowrap">{p.bed}</td>
                                            <td className="p-2 text-sm whitespace-nowrap">{p.name}</td>
                                            <td className="p-2 text-sm whitespace-nowrap">{p.furigana}</td>
                                        </tr>
                                    )) : 
                                    <tr>
                                        <td colSpan="6" className="text-center py-8 text-gray-500">この施設にはまだ患者が登録されていません。</td>
                                    </tr>
                                }
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    );
};

// --- 2. Monitor Page ---
const MonitorPage = () => {
    const { allPatients, loading } = useAllDayPatients();
    const callingPatients = allPatients.filter(p => p.status === '呼出中').sort((a, b) => a.bed.localeCompare(b.bed, undefined, {numeric: true}));
    const treatmentPatients = allPatients.filter(p => p.status === '治療中').sort((a, b) => a.bed.localeCompare(b.bed, undefined, {numeric: true}));
    
    const prevCallingPatientIdsRef = useRef(new Set());
    const [isSpeaking, setIsSpeaking] = useState(false);
    const speechQueueRef = useRef([]);
    
    // --- 音声停止機能のために追加 ---
    const currentAudioRef = useRef(null); // 現在再生中のAudioオブジェクトを管理
    const nowPlayingRef = useRef(null);   // 現在再生中の患者情報を管理
    const nextSpeechTimerRef = useRef(null); // 次の再生までのタイマーを管理
    // --- ここまで ---

    const speakNextInQueue = useCallback(() => {
        // 既存のタイマーがあればクリア
        if (nextSpeechTimerRef.current) {
            clearTimeout(nextSpeechTimerRef.current);
            nextSpeechTimerRef.current = null;
        }

        // キューが空なら再生終了
        if (speechQueueRef.current.length === 0) {
            setIsSpeaking(false);
            nowPlayingRef.current = null;
            return;
        }

        setIsSpeaking(true);
        const patient = speechQueueRef.current.shift();
        nowPlayingRef.current = patient; // 再生中の患者を記録

        const nameToSpeak = patient.furigana || patient.name;
        const textToSpeak = `${nameToSpeak}さんのお迎えのかた、${patient.bed}番ベッドへお願いします。`;
        
        const functionUrl = "https://synthesizespeech-dewqhzsp5a-uc.a.run.app";

        if (!textToSpeak || textToSpeak.trim() === "") {
            // テキストが空なら1秒後に次へ
            nextSpeechTimerRef.current = setTimeout(speakNextInQueue, 1000);
            return;
        }

        fetch(functionUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: textToSpeak }),
        })
        .then(res => res.json())
        .then(data => {
            if (data.audioContent) {
                const audio = new Audio("data:audio/mp3;base64," + data.audioContent);
                currentAudioRef.current = audio; // Audioオブジェクトを記録
                audio.play();
                audio.onended = () => {
                    currentAudioRef.current = null;
                    // 再生終了後、1秒待ってから次のキューへ
                    nextSpeechTimerRef.current = setTimeout(speakNextInQueue, 1000);
                };
            } else {
                throw new Error(data.error || 'Audio content not found');
            }
        })
        .catch((error) => {
            console.error("Speech synthesis failed:", error);
            currentAudioRef.current = null;
             // エラー時も1秒待ってから次へ
            nextSpeechTimerRef.current = setTimeout(speakNextInQueue, 1000);
        });
    }, []); // 依存配列は空

    useEffect(() => {
        const currentCallingIds = new Set(callingPatients.map(p => p.id));
        const prevCallingIds = prevCallingPatientIdsRef.current;

        // 1. 新しく呼び出しリストに追加された患者を特定し、キューに追加
        const newPatientsToCall = callingPatients.filter(p => !prevCallingIds.has(p.id));
        if (newPatientsToCall.length > 0) {
            speechQueueRef.current.push(...newPatientsToCall);
            // 現在再生中でなければ、再生を開始する
            if (!isSpeaking) {
                speakNextInQueue();
            }
        }
        
        // 2. 呼び出しリストから削除された（キャンセルされた）患者を特定
        const cancelledPatientIds = [...prevCallingIds].filter(id => !currentCallingIds.has(id));
        if (cancelledPatientIds.length > 0) {
            const cancelledIdSet = new Set(cancelledPatientIds);

            // 3. 再生待機キューの中からキャンセルされた患者を削除
            speechQueueRef.current = speechQueueRef.current.filter(p => !cancelledIdSet.has(p.id));
            
            // 4. もし現在再生中の患者がキャンセルされた場合、音声を停止
            if (nowPlayingRef.current && cancelledIdSet.has(nowPlayingRef.current.id)) {
                if (currentAudioRef.current) {
                    currentAudioRef.current.pause(); // 音声を停止
                    currentAudioRef.current = null;
                }
                nowPlayingRef.current = null;
                // 次の再生タイマーもキャンセル
                if (nextSpeechTimerRef.current) {
                    clearTimeout(nextSpeechTimerRef.current);
                    nextSpeechTimerRef.current = null;
                }
                // 即座に次の患者の再生を開始
                speakNextInQueue();
            }
        }
        
        prevCallingPatientIdsRef.current = currentCallingIds;
    }, [callingPatients, isSpeaking, speakNextInQueue]);
    
    if (loading) return <LoadingSpinner text="モニターデータを読み込み中..." />;
    
    return (
        <div>
            <h2 className="text-3xl font-bold mb-6 text-center text-gray-700">呼び出しモニター</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="bg-blue-100 p-6 rounded-lg shadow-lg">
                    <h3 className="text-2xl font-semibold mb-4 text-blue-800 text-center">お呼び出し済み</h3>
                    <div className="space-y-3 text-center">
                        {callingPatients.length > 0 ? callingPatients.map(p => (<p key={p.id} className="text-2xl md:text-3xl p-4 bg-white rounded-md shadow">No.{p.bed} {p.name} 様</p>)) : <p className="text-gray-500">現在、お呼び出し済みの患者さんはいません。</p>}
                    </div>
                </div>
                <div className="bg-green-100 p-6 rounded-lg shadow-lg">
                    <h3 className="text-2xl font-semibold mb-4 text-green-800 text-center">治療中</h3>
                     <div className="space-y-3 text-center">
                        {treatmentPatients.length > 0 ? treatmentPatients.map(p => (<p key={p.id} className="text-2xl md:text-3xl p-4 bg-white rounded-md shadow">No.{p.bed} {p.name} 様</p>)) : <p className="text-gray-500">現在、治療中の患者さんはいません。</p>}
                    </div>
                </div>
            </div>
            {isSpeaking && <div className="fixed bottom-5 right-5 bg-yellow-400 text-black font-bold py-2 px-4 rounded-full shadow-lg flex items-center"><svg className="animate-spin h-5 w-5 mr-3" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>音声再生中...</div>}
        </div>
    );
};

// --- 3. Staff Page ---
const StaffPage = () => {
    const { allPatients, loading } = useAllDayPatients();
    const { selectedFacility, selectedDate } = useContext(AppContext);
    
    const [isScannerOpen, setScannerOpen] = useState(false);

    const actionPatients = allPatients
        .filter(p => p.status === '治療中' || p.status === '呼出中')
        .sort((a, b) => a.bed.localeCompare(b.bed, undefined, {numeric: true}));

    const handleScanSuccess = useCallback((decodedText) => {
        let result;
        const patientToCall = allPatients.find(p => p.masterPatientId === decodedText && p.status === '治療中');

        if (patientToCall) {
            updatePatientStatus(selectedFacility, selectedDate, patientToCall.cool, patientToCall.id, '呼出中');
            result = { success: true, message: `${patientToCall.name} さんを呼び出しました。` };
        } else {
            const alreadyCalled = allPatients.find(p => p.masterPatientId === decodedText);
            if (alreadyCalled) {
                result = { success: false, message: `既にお呼び出し済みか、対象外です。` };
            } else {
                result = { success: false, message: '患者が見つかりません。' };
            }
        }
        return result;
    }, [allPatients, selectedFacility, selectedDate]);
    
    if (loading) return <LoadingSpinner text="呼び出しリストを読み込み中..." />;

    return (
        <div>
            <h2 className="text-2xl font-bold mb-4">スタッフ用端末</h2>
            {isScannerOpen && 
                <QrScannerModal 
                    onClose={() => setScannerOpen(false)} 
                    onScanSuccess={handleScanSuccess}
                />
            }
            <div className="bg-white p-6 rounded-lg shadow">
                <div className="flex justify-between items-center mb-4">
                    <h3 className="text-xl font-semibold">呼び出し操作 (全クール)</h3>
                    <button onClick={() => setScannerOpen(true)} className="flex items-center space-x-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2 px-4 rounded-lg transition">
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v1m6 1V4m-6 1v1m0-1H9m3 0h3m-3 0v1m0 0v1m-6-1V4m6 1v1M4 8h16M4 12h16M4 16h16" /></svg>
                        <span>QRで呼出</span>
                    </button>
                </div>
                <div className="overflow-x-auto">
                    {actionPatients.length > 0 ? (
                        <div className="space-y-3">
                            {actionPatients.map(p => (
                                <div key={p.id} className="flex items-center p-3 bg-gray-50 rounded-lg shadow-sm min-w-max">
                                    <div className="whitespace-nowrap pr-4 flex space-x-2">
                                        {p.status === '治療中' && 
                                            <button title="呼出" onClick={() => updatePatientStatus(selectedFacility, selectedDate, p.cool, p.id, '呼出中')} className="p-3 rounded-lg bg-blue-500 hover:bg-blue-600 text-white transition">
                                                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" /></svg>
                                            </button>
                                        }
                                        {p.status === '呼出中' &&
                                            <button title="キャンセル" onClick={() => updatePatientStatus(selectedFacility, selectedDate, p.cool, p.id, '治療中')} className="p-3 rounded-lg bg-gray-500 hover:bg-gray-600 text-white transition">
                                                 <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 10h10a8 8 0 018 8v2M3 10l6-6m-6 6l6 6" /></svg>
                                            </button>
                                        }
                                    </div>
                                    <div className="flex items-center whitespace-nowrap">
                                        <StatusBadge status={p.status}/>
                                        <span className="text-sm font-semibold bg-gray-200 text-gray-700 px-2 py-1 rounded ml-2 mr-3">{p.cool}クール</span>
                                        <span className="text-lg font-medium mr-4">No.{p.bed} {p.name} 様</span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : (<p className="text-gray-500 text-center py-4">操作対象の患者さんはいません。</p>)}
                </div>
            </div>
        </div>
    );
};

// 修正対象のコンポーネント
const QrScannerModal = ({ onClose, onScanSuccess }) => {
    const [scanResult, setScanResult] = useState(null);
    
    // --- カメラ切り替え機能のために追加 ---
    const [cameras, setCameras] = useState([]); // 利用可能なカメラのリスト
    const [selectedCameraId, setSelectedCameraId] = useState(''); // 選択中のカメラID
    // --- ここまで ---
    
    const isProcessingRef = useRef(false);
    
    const onScanSuccessRef = useRef(onScanSuccess);
    useEffect(() => {
        onScanSuccessRef.current = onScanSuccess;
    }, [onScanSuccess]);

    // ▼ コンポーネント表示時に一度だけ、利用可能なカメラを取得する
    useEffect(() => {
        Html5Qrcode.getCameras().then(devices => {
            if (devices && devices.length) {
                setCameras(devices);
                // 優先的に背面カメラ(environment)を選択、なければ最初のカメラを選択
                const backCamera = devices.find(device => device.label.toLowerCase().includes('back')) || devices[0];
                setSelectedCameraId(backCamera.id);
            }
        }).catch(err => {
            console.error("カメラの取得に失敗しました。", err);
        });
    }, []);

    // ▼ 選択されたカメラIDが変わるたびに、スキャナを再起動する
    useEffect(() => {
        // 選択されたカメラがない場合は何もしない
        if (!selectedCameraId) {
            return;
        }

        const html5QrCode = new Html5Qrcode('qr-reader-container');
        
        const qrCodeSuccessCallback = (decodedText, decodedResult) => {
            if (isProcessingRef.current) return;
            isProcessingRef.current = true;
            const result = onScanSuccessRef.current(decodedText);
            setScanResult(result);
            setTimeout(() => {
                isProcessingRef.current = false;
            }, 1000); // 1秒間は再スキャンしない
        };

        const config = { fps: 10, qrbox: { width: 250, height: 250 } };

        html5QrCode.start(
            selectedCameraId, // 選択されたカメラIDを使用
            config,
            qrCodeSuccessCallback,
            undefined
        ).catch(err => {
            console.error("スキャンの開始に失敗しました。", err);
            setScanResult({ success: false, message: "カメラの起動に失敗しました。" });
        });

        // モーダルが閉じる時、またはカメラが切り替わる時にスキャナを停止
        return () => {
            if (html5QrCode && html5QrCode.isScanning) {
                html5QrCode.stop().catch(err => {
                    console.error("スキャナの停止に失敗しました。", err);
                });
            }
        };
    }, [selectedCameraId]); // selectedCameraIdが変更されたらこのuseEffectを再実行

    // --- カメラ切り替えボタンの処理 ---
    const handleCameraSwitch = () => {
        if (cameras.length < 2) return; // カメラが2つ未満なら何もしない
        const currentIndex = cameras.findIndex(c => c.id === selectedCameraId);
        const nextIndex = (currentIndex + 1) % cameras.length;
        setSelectedCameraId(cameras[nextIndex].id);
    };

    return (
        <CustomModal title="QRコードで呼び出し" onClose={onClose} footer={<button onClick={onClose} className="bg-gray-300 hover:bg-gray-400 text-gray-800 font-bold py-2 px-6 rounded-lg">閉じる</button>}>
            <div id="qr-reader-container" className="w-full relative"></div>
            
            {/* --- カメラ切り替えボタンのUI --- */}
            {cameras.length > 1 && (
                <div className="text-center mt-3">
                    <button 
                        onClick={handleCameraSwitch} 
                        className="bg-gray-600 hover:bg-gray-700 text-white font-bold py-2 px-4 rounded-lg transition inline-flex items-center"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h5M20 20v-5h-5M4 9a9 9 0 0114.13-4.13M20 15a9 9 0 01-14.13 4.13" />
                        </svg>
                        カメラ切替
                    </button>
                </div>
            )}
            {/* --- ここまで --- */}
            
            {scanResult && (
                <div className={`mt-4 p-3 rounded text-center font-semibold ${scanResult.success ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                    {scanResult.message}
                </div>
            )}
        </CustomModal>
    );
};


// --- 4. Driver Page ---
const DriverPage = () => {
    const { allPatients, loading } = useAllDayPatients();
    const callingPatients = allPatients.filter(p => p.status === '呼出中').sort((a, b) => a.bed.localeCompare(b.bed, undefined, {numeric: true}));
    if (loading) return <LoadingSpinner text="送迎リストを読み込み中..." />;
    return (
        <div>
            <h2 className="text-2xl font-bold mb-4">送迎担当者用画面</h2>
            <div className="bg-white p-6 rounded-lg shadow">
                <h3 className="text-xl font-semibold mb-4">お呼び出し済みの患者様</h3>
                {callingPatients.length > 0 ? (
                    <div className="space-y-3">
                        {callingPatients.map(p => (<div key={p.id} className="p-4 bg-blue-100 rounded-lg text-blue-800 font-semibold text-lg">No.{p.bed} {p.name} 様</div>))}
                    </div>
                ) : (<p className="text-gray-500 text-center py-4">現在、お呼び出し済みの患者さんはいません。</p>)}
            </div>
        </div>
    );
};

// --- Global Controls & Layout ---
const GlobalControls = ({ hideCoolSelector = false }) => {
    const { selectedFacility, setSelectedFacility, selectedDate, setSelectedDate, selectedCool, setSelectedCool } = useContext(AppContext);
    return (
        <div className={`w-full bg-gray-100 p-3 rounded-lg mt-4 grid grid-cols-1 sm:grid-cols-${hideCoolSelector ? '2' : '3'} gap-3`}>
            <div>
                <label htmlFor="global-facility" className="block text-xs font-medium text-gray-600">施設</label>
                <select id="global-facility" value={selectedFacility} onChange={(e) => setSelectedFacility(e.target.value)} className="w-full p-2 border border-gray-300 rounded-md transition text-sm">{FACILITIES.map(f => <option key={f} value={f}>{f}</option>)}</select>
            </div>
            <div>
                <label htmlFor="global-date" className="block text-xs font-medium text-gray-600">日付</label>
                <input type="date" id="global-date" value={selectedDate} onChange={e => setSelectedDate(e.target.value)} className="w-full p-2 border border-gray-300 rounded-md transition text-sm" />
            </div>
            {!hideCoolSelector && (
                <div>
                    <label htmlFor="global-cool" className="block text-xs font-medium text-gray-600">クール</label>
                    <select id="global-cool" value={selectedCool} onChange={e => setSelectedCool(e.target.value)} className="w-full p-2 border border-gray-300 rounded-md transition text-sm"><option value="1">1</option><option value="2">2</option><option value="3">3</option></select>
                </div>
            )}
        </div>
    );
};

const AppLayout = ({ children, navButtons, user, onGoBack, hideCoolSelector }) => (
    <div className="min-h-screen bg-gray-50 font-sans">
        <nav className="bg-white shadow-md p-3 sm:p-4 mb-8 sticky top-0 z-40">
            <div className="max-w-7xl mx-auto px-4">
                <div className="flex flex-wrap justify-between items-center">
                    <div className="flex items-center">
                        {onGoBack && (
                           <button onClick={onGoBack} className="mr-4 flex items-center text-sm text-gray-600 hover:text-blue-600 transition">
                               <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                   <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                               </svg>
                               <span className="hidden sm:inline ml-1">戻る</span>
                           </button>
                        )}
                        <h1 className="text-lg sm:text-xl font-bold text-gray-800">患者呼び出しシステム</h1>
                    </div>
                    <div className="flex items-center space-x-1 sm:space-x-2 mt-2 sm:mt-0">
                       {navButtons}
                    </div>
                </div>
                <GlobalControls hideCoolSelector={hideCoolSelector} />
            </div>
        </nav>
        <main className="max-w-7xl mx-auto px-4 pb-8">{children}</main>
         <footer className="text-center text-sm text-gray-500 py-6 mt-8 border-t"><p>ユーザーID: <span className="font-mono text-xs">{user?.uid}</span></p></footer>
    </div>
);

// --- Role-based Views ---
const StaffView = ({ user, onGoBack }) => {
    const [currentPage, setCurrentPage] = useState('admin');
    const hideCoolSelector = currentPage === 'monitor' || currentPage === 'staff';
    const NavButton = ({ page, label }) => (<button onClick={() => setCurrentPage(page)} className={`px-3 py-2 sm:px-4 rounded-lg font-medium transition duration-200 text-sm sm:text-base ${ currentPage === page ? 'bg-blue-600 text-white shadow-md' : 'bg-white text-gray-700 hover:bg-gray-200'}`}>{label}</button>);
    
    const renderPage = () => {
        switch (currentPage) {
            case 'admin': return <AdminPage />;
            case 'staff': return <StaffPage />;
            case 'monitor': return <MonitorPage />;
            default: return <AdminPage />;
        }
    };
    
    return (
        <AppLayout user={user} onGoBack={onGoBack} hideCoolSelector={hideCoolSelector} navButtons={<><NavButton page="admin" label="管理" /><NavButton page="staff" label="スタッフ" /><NavButton page="monitor" label="モニター" /></>}>
            {renderPage()}
        </AppLayout>
    );
}

const PublicView = ({ user, onGoBack }) => {
    return (
        <AppLayout user={user} onGoBack={onGoBack} hideCoolSelector={true} navButtons={<span className="font-semibold text-gray-700">送迎担当者用</span>}>
            <DriverPage />
        </AppLayout>
    );
};

// --- Login / Role Selection ---
const FacilitySelectionPage = ({ onSelectFacility, onGoBack }) => (
    <div className="flex items-center justify-center h-screen bg-gray-100">
        <div className="text-center p-8 bg-white rounded-xl shadow-lg max-w-md w-full">
            <h1 className="text-3xl font-bold text-gray-800 mb-4">施設を選択してください</h1>
            <p className="text-gray-600 mb-8">表示する施設を選択してください。</p>
            <div className="space-y-4">
                {FACILITIES.map(facility => (
                    <button 
                        key={facility} 
                        onClick={() => onSelectFacility(facility)} 
                        className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-4 px-6 rounded-lg transition duration-300 text-lg"
                    >
                        {facility}
                    </button>
                ))}
            </div>
            <button onClick={onGoBack} className="mt-8 text-sm text-gray-600 hover:text-blue-600 transition">
                役割選択に戻る
            </button>
        </div>
    </div>
);

const PasswordModal = ({ onSuccess, onCancel }) => {
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    
    const CORRECT_PASSWORD = '2366';

    const handleSubmit = (e) => {
        e.preventDefault();
        if (password === CORRECT_PASSWORD) {
            onSuccess();
        } else {
            setError('パスワードが違います。');
        }
    };

    return (
        <CustomModal title="スタッフ用パスワード認証" onClose={onCancel}>
            <form onSubmit={handleSubmit}>
                <p className="mb-4">スタッフ用のパスワードを入力してください。</p>
                <input 
                    type="password"
                    value={password}
                    onChange={(e) => { setPassword(e.target.value); setError(''); }}
                    className="w-full p-2 border rounded-md"
                    autoFocus
                />
                {error && <p className="text-red-500 text-sm mt-2">{error}</p>}
                <div className="mt-6 flex justify-end">
                    <button type="submit" className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-6 rounded-lg">
                        認証
                    </button>
                </div>
            </form>
        </CustomModal>
    );
};

const RoleSelectionPage = ({ onSelectRole }) => {
    return (
    <div className="flex items-center justify-center h-screen bg-gray-100">
        <div className="text-center p-8 bg-white rounded-xl shadow-lg max-w-md w-full">
            <h1 className="text-3xl font-bold text-gray-800 mb-4">患者呼び出しシステム</h1>
            <p className="text-gray-600 mb-8">利用する役割を選択してください</p>
            <div className="space-y-4">
                <button onClick={() => onSelectRole('staff')} className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-4 px-6 rounded-lg transition duration-300 text-lg">
                    スタッフ用
                </button>
                <button onClick={() => onSelectRole('public')} className="w-full bg-green-600 hover:bg-green-700 text-white font-bold py-4 px-6 rounded-lg transition duration-300 text-lg">
                    公開用 (送迎)
                </button>
            </div>
        </div>
    </div>
    );
};


// --- Main App ---
export default function App() {
    const [user, setUser] = useState(null);
    const [authReady, setAuthReady] = useState(false);
    const [viewMode, setViewMode] = useState('login'); // 'login', 'password', 'facilitySelection', 'staff', 'public'
    const [selectedRole, setSelectedRole] = useState(null); // 'staff' or 'public'
    
    const [selectedFacility, setSelectedFacility] = useState(FACILITIES[0]);
    const [selectedDate, setSelectedDate] = useState(getTodayString());
    const [selectedCool, setSelectedCool] = useState('1');

    useEffect(() => {
        const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
            if (currentUser) {
                setUser(currentUser);
            } else {
                try {
                    await signInAnonymously(auth);
                } catch (error) {
                    console.error("Anonymous sign-in failed:", error);
                }
            }
            setAuthReady(true);
        });
        return () => unsubscribe();
    }, []);

    const handleRoleSelect = (role) => {
        setSelectedRole(role);
        if (role === 'staff') {
            setViewMode('password');
        } else {
            setViewMode('facilitySelection');
        }
    };

    const handlePasswordSuccess = () => {
        setViewMode('facilitySelection');
    };

    const handleFacilitySelect = (facility) => {
        setSelectedFacility(facility);
        setViewMode(selectedRole);
    };
    
    const handleGoBack = () => {
        setViewMode('login');
        setSelectedRole(null);
    };

    if (!authReady || !user) {
        return <div className="h-screen w-screen flex justify-center items-center bg-gray-100"><LoadingSpinner text="認証情報を確認中..." /></div>;
    }

    return (
        <AppContext.Provider value={{ selectedFacility, setSelectedFacility, selectedDate, setSelectedDate, selectedCool, setSelectedCool }}>
            {viewMode === 'login' && <RoleSelectionPage onSelectRole={handleRoleSelect} />}
            {viewMode === 'password' && <PasswordModal onSuccess={handlePasswordSuccess} onCancel={() => setViewMode('login')} />}
            {viewMode === 'facilitySelection' && <FacilitySelectionPage onSelectFacility={handleFacilitySelect} onGoBack={() => setViewMode('login')} />}
            {viewMode === 'staff' && <StaffView user={user} onGoBack={handleGoBack} />}
            {viewMode === 'public' && <PublicView user={user} onGoBack={handleGoBack} />}
        </AppContext.Provider>
    );
}

