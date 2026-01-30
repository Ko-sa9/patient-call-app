import React, { useState, useEffect, createContext, useContext, useRef, useCallback, useMemo } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, collection, doc, onSnapshot, query, where, addDoc, getDocs, deleteDoc, updateDoc, serverTimestamp, writeBatch, setDoc } from 'firebase/firestore';
import { getFunctions } from 'firebase/functions';
import { Html5Qrcode, Html5QrcodeSupportedFormats } from 'html5-qrcode';
import * as wanakana from 'wanakana';
import QrCodeListPage from './components/QrCodeListPage.js';
import { DndProvider, useDrag, useDrop } from 'react-dnd';
import { HTML5Backend } from 'react-dnd-html5-backend';
import { QRCodeSVG } from 'qrcode.react';

// ==========================================================================================
// 1. 初期設定・ユーティリティ
// ==========================================================================================

// --- 音声オブジェクト ---
const globalSuccessAudio = new Audio('/sounds/success.mp3');
const globalErrorAudio = new Audio('/sounds/error.mp3');

// --- Firebase設定 ---
const firebaseConfig = {
    apiKey: process.env.REACT_APP_FIREBASE_API_KEY,
    authDomain: "patient-call-app-f5e7f.firebaseapp.com",
    projectId: "patient-call-app-f5e7f",
    storageBucket: "patient-call-app-f5e7f.appspot.com",
    messagingSenderId: "545799005149",
    appId: "1:545799005149:web:f1b22a42040eb455e98c34"
};

// --- Firebase初期化 ---
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const functions = getFunctions(app, 'us-central1');

// --- ヘルパー関数 ---
const getTodayString = () => {
    const today = new Date();
    today.setHours(today.getHours() + 9);
    return today.toISOString().split('T')[0];
}

const getDayQueryString = (dateString) => {
    const date = new Date(dateString);
    const dayIndex = date.getDay();
    if ([1, 3, 5].includes(dayIndex)) return '月水金';
    if ([2, 4, 6].includes(dayIndex)) return '火木土';
    return null;
};

const isMobileDevice = () => {
    const ua = navigator.userAgent;
    if (/Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua)) return true;
    if (ua.includes("Mac") && navigator.maxTouchPoints > 1) return true;
    return false;
};

// --- UIコンポーネント ---
const LoadingSpinner = ({ text = "読み込み中..." }) => (
    <div className="flex flex-col justify-center items-center h-full my-8">
        <div className="animate-spin rounded-full h-12 w-12 border-t-4 border-b-4 border-blue-500"></div>
        <p className="mt-4 text-gray-600">{text}</p>
    </div>
);

const CustomModal = ({ title, children, onClose, footer }) => (
    <div className="fixed inset-0 bg-black bg-opacity-60 flex justify-center items-center z-50 p-4">
        <div className="bg-white p-6 rounded-lg shadow-xl w-full max-w-lg">
            <div className="flex justify-between items-center border-b pb-3 mb-4">
                <h3 className="text-xl font-bold">{title}</h3>
                {onClose && <button onClick={onClose} className="text-gray-500 hover:text-gray-800 text-2xl">&times;</button>}
            </div>
            <div className="mb-6">{children}</div>
            {footer && <div className="border-t pt-4 flex justify-end space-x-3">{footer}</div>}
        </div>
    </div>
);

const ConfirmationModal = ({ title, message, onConfirm, onCancel, confirmText = "実行", confirmColor = "blue" }) => (
    <CustomModal
        title={title}
        onClose={onCancel}
        footer={
            <>
                <button onClick={onCancel} className="bg-gray-300 hover:bg-gray-400 text-gray-800 font-bold py-2 px-6 rounded-lg">キャンセル</button>
                <button onClick={onConfirm} className={`font-bold py-2 px-6 rounded-lg transition text-white ${confirmColor === 'red' ? 'bg-red-600 hover:bg-red-700' : 'bg-blue-600 hover:bg-blue-700'}`}>
                    {confirmText}
                </button>
            </>
        }
    >
        <p>{message}</p>
    </CustomModal>
);

// ==========================================================================================
// 2. 状態管理 (Context & Hooks)
// ==========================================================================================

const AppContext = createContext();
const FACILITIES = ["本院透析室", "入院透析室", "坂田透析棟", "じんクリニック", "木更津クリニック"];

// --- Hooks ---
const useDailyList = () => {
    const { selectedFacility, selectedDate, selectedCool } = useContext(AppContext);
    const [dailyList, setDailyList] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (selectedFacility === "入院透析室" || !selectedFacility || !selectedDate || !selectedCool) {
            setDailyList([]);
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
        if (selectedFacility === "入院透析室" || !selectedFacility || !selectedDate) {
            setAllPatients([]);
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
            if (Object.values(loadedFlags).every(flag => flag)) setLoading(false);
        };

        cools.forEach(cool => {
            const dailyListId = `${selectedDate}_${selectedFacility}_${cool}`;
            const dailyPatientsCollectionRef = collection(db, 'daily_lists', dailyListId, 'patients');
            const q = query(dailyPatientsCollectionRef);
            const unsubscribe = onSnapshot(q, (snapshot) => {
                patientData[cool] = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data(), cool: cool }));
                updateCombinedList();
                if (!loadedFlags[cool]) { loadedFlags[cool] = true; checkLoadingDone(); }
            }, (err) => {
                console.error(`Error fetching list for cool ${cool}:`, err);
                patientData[cool] = []; updateCombinedList();
                if (!loadedFlags[cool]) { loadedFlags[cool] = true; checkLoadingDone(); }
            });
            unsubscribes.push(unsubscribe);
        });
        return () => unsubscribes.forEach(unsub => unsub());
    }, [selectedFacility, selectedDate]);
    return { allPatients, loading };
};

const updatePatientStatus = async (facility, date, cool, patientId, newStatus) => {
    const dailyListId = `${date}_${facility}_${cool}`;
    const patientDocRef = doc(db, 'daily_lists', dailyListId, 'patients', patientId);
    try {
        await updateDoc(patientDocRef, { status: newStatus, updatedAt: serverTimestamp() });
    } catch (error) {
        console.error("Error updating status: ", error);
        alert("ステータスの更新に失敗しました。");
    }
};

const StatusBadge = ({ status }) => {
    const statusStyles = { '治療中': 'bg-green-200 text-green-800', '呼出中': 'bg-blue-200 text-blue-800', '退出済': 'bg-gray-500 text-white' };
    return <span className={`text-xs font-semibold mr-2 px-2.5 py-0.5 rounded-full ${statusStyles[status] || 'bg-gray-200'}`}>{status}</span>;
};

// ==========================================================================================
// 3. 通常透析室向けページコンポーネント
// ==========================================================================================

const RequiredBadge = () => <span className="ml-2 bg-red-500 text-white text-xs font-semibold px-2 py-0.5 rounded-full">必須</span>;

// --- AdminPage ---
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
    const isFuriganaManuallyEdited = useRef(false);
    const [formError, setFormError] = useState('');
    const [masterSearchTerm, setMasterSearchTerm] = useState('');
    const [addDailyModalOpen, setAddDailyModalOpen] = useState(false);
    const [dailyModalMode, setDailyModalMode] = useState('search');
    const [tempPatientSearchTerm, setTempPatientSearchTerm] = useState('');
    const initialDailyFormData = { lastName: '', firstName: '', furigana: '', bed: '' };
    const [dailyFormData, setDailyFormData] = useState(initialDailyFormData);
    const [dailyFuriganaParts, setDailyFuriganaParts] = useState({ last: '', first: '' });
    const isDailyFuriganaManual = useRef(false);
    const [editDailyModalOpen, setEditDailyModalOpen] = useState(false);
    const [editingDailyPatient, setEditingDailyPatient] = useState(null);
    const [editDailyFormData, setEditDailyFormData] = useState({ lastName: '', firstName: '', furigana: '', bed: '' });
    const [editFuriganaParts, setEditFuriganaParts] = useState({ last: '', first: '' });
    const isEditFuriganaManual = useRef(false);
    const [confirmMasterDelete, setConfirmMasterDelete] = useState({ isOpen: false, patientId: null });
    const [confirmDailyDelete, setConfirmDailyDelete] = useState({ isOpen: false, patientId: null });
    const [confirmLoadModal, setConfirmLoadModal] = useState({ isOpen: false, onConfirm: () => { } });
    const [confirmClearListModal, setConfirmClearListModal] = useState({ isOpen: false });
    const [showQrList, setShowQrList] = useState(false);
    
    // ★修正: 再レンダリングのたびにcollection参照が変わらないようmemo化
    const masterPatientsCollectionRef = useMemo(() => collection(db, 'patients'), []);
    const dailyPatientsCollectionRef = (cool) => collection(db, 'daily_lists', `${selectedDate}_${selectedFacility}_${cool}`, 'patients');

    useEffect(() => {
        setLoadingMaster(true);
        const q = query(masterPatientsCollectionRef, where("facility", "==", selectedFacility));
        const unsubscribe = onSnapshot(q, (snapshot) => {
            const patientsData = snapshot.docs.map(doc => {
                const data = doc.data();
                let lastName = data.lastName || ''; let firstName = data.firstName || ''; let name = '';
                if (lastName || firstName) name = `${lastName} ${firstName}`.trim();
                else if (data.name) {
                    const nameParts = data.name.split(/[\s　]+/);
                    lastName = nameParts[0] || ''; firstName = nameParts.slice(1).join(' ') || '';
                    name = data.name;
                }
                return { id: doc.id, ...data, name, lastName, firstName };
            });
            setMasterPatients(patientsData);
            setLoadingMaster(false);
        }, () => setLoadingMaster(false));
        return () => unsubscribe();
    }, [selectedFacility, masterPatientsCollectionRef]);

    useEffect(() => {
        if (isFuriganaManuallyEdited.current) return;
        const combinedFurigana = [furiganaParts.last, furiganaParts.first].filter(Boolean).join(' ');
        setMasterFormData(prev => ({ ...prev, furigana: combinedFurigana }));
    }, [furiganaParts]);

    useEffect(() => {
        if (isDailyFuriganaManual.current) return;
        const combinedFurigana = [dailyFuriganaParts.last, dailyFuriganaParts.first].filter(Boolean).join(' ');
        setDailyFormData(prev => ({ ...prev, furigana: combinedFurigana }));
    }, [dailyFuriganaParts]);

    useEffect(() => {
        if (isEditFuriganaManual.current) return;
        const combinedFurigana = [editFuriganaParts.last, editFuriganaParts.first].filter(Boolean).join(' ');
        setEditDailyFormData(prev => ({ ...prev, furigana: combinedFurigana }));
    }, [editFuriganaParts]);

    const handleOpenMasterModal = (patient = null) => {
        setEditingMasterPatient(patient);
        isFuriganaManuallyEdited.current = false;
        setFormError('');
        if (patient) {
            setMasterFormData({ patientId: patient.patientId || '', lastName: patient.lastName || '', firstName: patient.firstName || '', furigana: patient.furigana || '', bed: patient.bed, day: patient.day, cool: patient.cool });
            if (patient.furigana) isFuriganaManuallyEdited.current = true;
            setFuriganaParts({ last: '', first: '' });
        } else {
            setMasterFormData(initialMasterFormData);
            setFuriganaParts({ last: '', first: '' });
        }
        setMasterModalOpen(true);
    };

    const handleMasterFormChange = (e) => {
        const { name, value } = e.target;
        setFormError('');
        if (name === 'furigana') { isFuriganaManuallyEdited.current = true; setMasterFormData(prev => ({ ...prev, furigana: value })); return; }
        const isClearingName = (name === 'lastName' && value === '' && masterFormData.firstName === '') || (name === 'firstName' && value === '' && masterFormData.lastName === '');
        if (isClearingName) isFuriganaManuallyEdited.current = false;
        setMasterFormData(prev => ({ ...prev, [name]: value }));
        if (!isFuriganaManuallyEdited.current) {
            if (name === 'lastName' && wanakana.isKana(value)) setFuriganaParts(prev => ({ ...prev, last: wanakana.toHiragana(value) }));
            else if (name === 'firstName' && wanakana.isKana(value)) setFuriganaParts(prev => ({ ...prev, first: wanakana.toHiragana(value) }));
        }
    };

    const handleMasterSubmit = async (e) => {
        e.preventDefault();
        if (!masterFormData.lastName || !masterFormData.firstName || !masterFormData.bed || !masterFormData.patientId) { setFormError('必須項目をすべて入力してください。'); return; }
        const dataToSave = { patientId: masterFormData.patientId, lastName: masterFormData.lastName, firstName: masterFormData.firstName, furigana: masterFormData.furigana, bed: masterFormData.bed, day: masterFormData.day, cool: masterFormData.cool, facility: selectedFacility };
        try {
            if (editingMasterPatient) await updateDoc(doc(masterPatientsCollectionRef, editingMasterPatient.id), { ...dataToSave, updatedAt: serverTimestamp() });
            else await addDoc(masterPatientsCollectionRef, { ...dataToSave, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
            setMasterModalOpen(false);
        } catch (error) { setFormError('保存中にエラーが発生しました。'); }
    };

    const handleOpenAddDailyModal = () => { setDailyModalMode('search'); setTempPatientSearchTerm(''); setDailyFormData(initialDailyFormData); setDailyFuriganaParts({ last: '', first: '' }); isDailyFuriganaManual.current = false; setFormError(''); setAddDailyModalOpen(true); };
    const handleDailyFormChange = (e) => {
        const { name, value } = e.target; setFormError('');
        if (name === 'furigana') { isDailyFuriganaManual.current = true; setDailyFormData(prev => ({ ...prev, furigana: value })); return; }
        if ((name === 'lastName' && value === '' && dailyFormData.firstName === '') || (name === 'firstName' && value === '' && dailyFormData.lastName === '')) isDailyFuriganaManual.current = false;
        setDailyFormData(prev => ({ ...prev, [name]: value }));
        if (!isDailyFuriganaManual.current) {
            if (name === 'lastName' && wanakana.isKana(value)) setDailyFuriganaParts(prev => ({ ...prev, last: wanakana.toHiragana(value) }));
            else if (name === 'firstName' && wanakana.isKana(value)) setDailyFuriganaParts(prev => ({ ...prev, first: wanakana.toHiragana(value) }));
        }
    };

    const handleAddTempFromMaster = async (patient) => {
        try {
            await addDoc(dailyPatientsCollectionRef(selectedCool), { name: patient.name, furigana: patient.furigana || '', bed: patient.bed, status: '治療中', isTemporary: true, masterPatientId: patient.patientId, masterDocId: patient.id, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
            setAddDailyModalOpen(false);
        } catch (error) { setFormError('臨時患者の追加に失敗しました。'); }
    };

    const handleAddDailySubmit = async (e) => {
        e.preventDefault();
        if (!dailyFormData.lastName || !dailyFormData.firstName || !dailyFormData.bed) { setFormError('必須項目をすべて入力してください。'); return; }
        try {
            await addDoc(dailyPatientsCollectionRef(selectedCool), { name: `${dailyFormData.lastName} ${dailyFormData.firstName}`.trim(), furigana: dailyFormData.furigana, bed: dailyFormData.bed, status: '治療中', isTemporary: true, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
            setAddDailyModalOpen(false);
        } catch (error) { setFormError('臨時患者の保存に失敗しました。'); }
    };

    const handleOpenEditDailyModal = (patient) => {
        const nameParts = (patient.name || '').split(/[\s　]+/);
        setEditingDailyPatient(patient);
        setEditDailyFormData({ lastName: nameParts[0] || '', firstName: nameParts.slice(1).join(' ') || '', furigana: patient.furigana || '', bed: patient.bed });
        setEditFuriganaParts({ last: '', first: '' }); isEditFuriganaManual.current = !!patient.furigana; setFormError(''); setEditDailyModalOpen(true);
    };

    const handleEditDailyFormChange = (e) => {
        const { name, value } = e.target; setFormError('');
        if (name === 'furigana') { isEditFuriganaManual.current = true; setEditDailyFormData(prev => ({ ...prev, furigana: value })); return; }
        if ((name === 'lastName' && value === '' && editDailyFormData.firstName === '') || (name === 'firstName' && value === '' && editDailyFormData.lastName === '')) isEditFuriganaManual.current = false;
        setEditDailyFormData(prev => ({ ...prev, [name]: value }));
        if (!isEditFuriganaManual.current) {
            if (name === 'lastName' && wanakana.isKana(value)) setEditFuriganaParts(prev => ({ ...prev, last: wanakana.toHiragana(value) }));
            else if (name === 'firstName' && wanakana.isKana(value)) setEditFuriganaParts(prev => ({ ...prev, first: wanakana.toHiragana(value) }));
        }
    };

    const handleEditDailySubmit = async (e) => {
        e.preventDefault();
        if (!editDailyFormData.lastName || !editDailyFormData.firstName || !editDailyFormData.bed) { setFormError('必須項目をすべて入力してください。'); return; }
        if (!editingDailyPatient) return;
        try {
            await updateDoc(doc(dailyPatientsCollectionRef(selectedCool), editingDailyPatient.id), { name: `${editDailyFormData.lastName} ${editDailyFormData.firstName}`.trim(), furigana: editDailyFormData.furigana, bed: editDailyFormData.bed, updatedAt: serverTimestamp() });
            setEditDailyModalOpen(false);
        } catch (error) { setFormError('更新中にエラーが発生しました。'); }
    };

    const handleConfirmMasterDelete = async () => { if (confirmMasterDelete.patientId) { await deleteDoc(doc(masterPatientsCollectionRef, confirmMasterDelete.patientId)); setConfirmMasterDelete({ isOpen: false, patientId: null }); } };
    const handleConfirmDailyDelete = async () => { if (confirmDailyDelete.patientId) { await deleteDoc(doc(dailyPatientsCollectionRef(selectedCool), confirmDailyDelete.patientId)); setConfirmDailyDelete({ isOpen: false, patientId: null }); } };

    const handleDeleteMasterClick = (patientId) => { setConfirmMasterDelete({ isOpen: true, patientId }); };
    const handleDeleteDailyClick = (patientId) => { setConfirmDailyDelete({ isOpen: true, patientId }); };

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
                batch.set(doc(db, 'daily_lists', dailyListId), { createdAt: serverTimestamp(), facility: selectedFacility, date: selectedDate, cool: selectedCool });
                masterSnapshot.forEach(patientDoc => {
                    const patientData = patientDoc.data();
                    batch.set(doc(dailyPatientsCollectionRef(selectedCool)), { name: `${patientData.lastName || ''} ${patientData.firstName || ''}`.trim() || patientData.name || '', furigana: patientData.furigana || '', bed: patientData.bed, status: '治療中', masterPatientId: patientData.patientId || null, masterDocId: patientDoc.id, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
                });
                await batch.commit();
            } catch (error) { alert("読み込みに失敗しました。"); } finally { setLoadingMaster(false); setConfirmLoadModal({ isOpen: false, onConfirm: () => { } }); }
        };
        if (dailyList.length > 0) setConfirmLoadModal({ isOpen: true, onConfirm: loadAction }); else loadAction();
    };

    const handleClearDailyList = async () => { try { const batch = writeBatch(db); dailyList.forEach(patient => batch.delete(doc(dailyPatientsCollectionRef(selectedCool), patient.id))); await batch.commit(); } catch (error) { alert("リストの削除に失敗しました。"); } finally { setConfirmClearListModal({ isOpen: false }); } };
    const handleSyncFromMaster = async (dailyPatient) => {
        const masterPatient = dailyPatient.masterDocId ? masterPatients.find(p => p.id === dailyPatient.masterDocId) : masterPatients.find(p => p.patientId === dailyPatient.masterPatientId);
        if (!masterPatient) { alert('同期元のマスター患者が見つかりません。'); return; }
        const updates = {};
        if (dailyPatient.masterPatientId !== masterPatient.patientId) updates.masterPatientId = masterPatient.patientId;
        if (dailyPatient.name !== masterPatient.name) updates.name = masterPatient.name;
        if (dailyPatient.furigana !== masterPatient.furigana) updates.furigana = masterPatient.furigana;
        if (dailyPatient.bed !== masterPatient.bed) updates.bed = masterPatient.bed;
        if (Object.keys(updates).length === 0) return;
        updates.updatedAt = serverTimestamp();
        try { await updateDoc(doc(dailyPatientsCollectionRef(selectedCool), dailyPatient.id), updates); } catch (error) { alert('マスターからの同期に失敗しました。'); }
    };

    if (showQrList) return <QrCodeListPage patients={masterPatients} onBack={() => setShowQrList(false)} />;

    return (
        <div className="space-y-8">
            {masterModalOpen && <CustomModal title={editingMasterPatient ? "患者情報の編集" : "新規患者登録"} onClose={() => setMasterModalOpen(false)} footer={<><button onClick={() => setMasterModalOpen(false)} className="bg-gray-300 hover:bg-gray-400 text-gray-800 font-bold py-2 px-6 rounded-lg">キャンセル</button><button onClick={handleMasterSubmit} className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-6 rounded-lg">保存</button></>}>
                <form onSubmit={handleMasterSubmit} className="space-y-4">
                    {formError && <p className="text-red-500 text-center font-bold mb-4 bg-red-100 p-3 rounded-lg">{formError}</p>}
                    <div><label className="block font-medium mb-1">患者ID (QRコード用)<RequiredBadge /></label><input type="text" name="patientId" value={masterFormData.patientId} onChange={handleMasterFormChange} className="w-full p-2 border rounded-md" placeholder="電子カルテID(8桁)" required /></div>
                    <div><label className="block font-medium mb-1">曜日</label><select name="day" value={masterFormData.day} onChange={handleMasterFormChange} className="w-full p-2 border rounded-md"><option value="月水金">月水金</option><option value="火木土">火木土</option></select></div>
                    <div><label className="block font-medium mb-1">クール</label><select name="cool" value={masterFormData.cool} onChange={handleMasterFormChange} className="w-full p-2 border rounded-md"><option value="1">1</option><option value="2">2</option><option value="3">3</option></select></div>
                    <div><label className="block font-medium mb-1">ベッド番号<RequiredBadge /></label><input type="text" name="bed" value={masterFormData.bed} onChange={handleMasterFormChange} className="w-full p-2 border rounded-md" required /></div>
                    <div className="grid grid-cols-2 gap-4"><div><label className="block font-medium mb-1">姓<RequiredBadge /></label><input type="text" name="lastName" value={masterFormData.lastName} onChange={handleMasterFormChange} className="w-full p-2 border rounded-md" placeholder="例：やまだ" required /></div><div><label className="block font-medium mb-1">名<RequiredBadge /></label><input type="text" name="firstName" value={masterFormData.firstName} onChange={handleMasterFormChange} className="w-full p-2 border rounded-md" placeholder="例：たろう" required /></div></div>
                    <div><label className="block font-medium mb-1">ふりがな (ひらがな)</label><input type="text" name="furigana" value={masterFormData.furigana} onChange={handleMasterFormChange} className="w-full p-2 border rounded-md" placeholder="自動入力されます" /></div>
                </form>
            </CustomModal>}
            {addDailyModalOpen && <CustomModal title="臨時患者の追加" onClose={() => setAddDailyModalOpen(false)}>
                <div className="border-b border-gray-200 mb-4"><nav className="-mb-px flex space-x-6"><button onClick={() => setDailyModalMode('search')} className={`${dailyModalMode === 'search' ? 'border-blue-500 text-blue-600' : 'border-transparent text-gray-500'} py-3 px-1 border-b-2 font-medium text-sm`}>マスタから検索</button><button onClick={() => setDailyModalMode('manual')} className={`${dailyModalMode === 'manual' ? 'border-blue-500 text-blue-600' : 'border-transparent text-gray-500'} py-3 px-1 border-b-2 font-medium text-sm`}>手動で新規登録</button></nav></div>
                {formError && <p className="text-red-500 text-center font-bold mb-4 bg-red-100 p-3 rounded-lg">{formError}</p>}
                {dailyModalMode === 'search' ? <div><input type="search" placeholder="患者ID, 氏名, ふりがなで検索" value={tempPatientSearchTerm} onChange={(e) => setTempPatientSearchTerm(e.target.value)} className="w-full p-2 border rounded-md mb-4" /><div className="max-h-60 overflow-y-auto space-y-2">{masterPatients.filter(p => { const term = tempPatientSearchTerm.toLowerCase(); return term && (p.patientId?.toLowerCase().includes(term) || p.name?.toLowerCase().includes(term) || p.furigana?.toLowerCase().includes(term)); }).map(p => (<div key={p.id} className="flex justify-between items-center p-2 border rounded-md"><div><p className="font-semibold">{p.name}</p><p className="text-sm text-gray-500">ベッド: {p.bed}</p></div><button onClick={() => handleAddTempFromMaster(p)} className="bg-blue-500 hover:bg-blue-600 text-white font-bold py-1 px-3 rounded-md text-sm">追加</button></div>))}</div></div> : <form onSubmit={handleAddDailySubmit} className="space-y-4"><div><label className="block font-medium mb-1">ベッド番号<RequiredBadge /></label><input type="text" name="bed" value={dailyFormData.bed} onChange={handleDailyFormChange} className="w-full p-2 border rounded-md" required /></div><div className="grid grid-cols-2 gap-4"><div><label className="block font-medium mb-1">姓<RequiredBadge /></label><input type="text" name="lastName" value={dailyFormData.lastName} onChange={handleDailyFormChange} className="w-full p-2 border rounded-md" placeholder="例：りんじ" required /></div><div><label className="block font-medium mb-1">名<RequiredBadge /></label><input type="text" name="firstName" value={dailyFormData.firstName} onChange={handleDailyFormChange} className="w-full p-2 border rounded-md" placeholder="例：たろう" required /></div></div><div><label className="block font-medium mb-1">ふりがな (ひらがな)</label><input type="text" name="furigana" value={dailyFormData.furigana} onChange={handleDailyFormChange} className="w-full p-2 border rounded-md" placeholder="自動入力されます" /></div><div className="flex justify-end pt-4"><button type="submit" className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-6 rounded-lg">登録</button></div></form>}
            </CustomModal>}
            {editDailyModalOpen && <CustomModal title="リスト情報の編集" onClose={() => setEditDailyModalOpen(false)} footer={<><button onClick={() => setEditDailyModalOpen(false)} className="bg-gray-300 hover:bg-gray-400 text-gray-800 font-bold py-2 px-6 rounded-lg">キャンセル</button><button onClick={handleEditDailySubmit} className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-6 rounded-lg">保存</button></>}>
                <form onSubmit={handleEditDailySubmit} className="space-y-4">
                    {formError && <p className="text-red-500 text-center font-bold mb-4 bg-red-100 p-3 rounded-lg">{formError}</p>}
                    <div className="grid grid-cols-2 gap-4"><div><label className="block font-medium mb-1">姓<RequiredBadge /></label><input type="text" name="lastName" value={editDailyFormData.lastName} onChange={handleEditDailyFormChange} className="w-full p-2 border rounded-md" required /></div><div><label className="block font-medium mb-1">名<RequiredBadge /></label><input type="text" name="firstName" value={editDailyFormData.firstName} onChange={handleEditDailyFormChange} className="w-full p-2 border rounded-md" required /></div></div>
                    <div><label className="block font-medium mb-1">ふりがな (ひらがな)</label><input type="text" name="furigana" value={editDailyFormData.furigana} onChange={handleEditDailyFormChange} className="w-full p-2 border rounded-md" /></div>
                    <div><label className="block font-medium mb-1">ベッド番号<RequiredBadge /></label><input type="text" name="bed" value={editDailyFormData.bed} onChange={handleEditDailyFormChange} className="w-full p-2 border rounded-md" required /></div>
                </form>
            </CustomModal>}
            {confirmMasterDelete.isOpen && <ConfirmationModal title="マスタから削除" message="この患者情報をマスタから完全に削除しますか？" onConfirm={handleConfirmMasterDelete} onCancel={() => setConfirmMasterDelete({ isOpen: false, patientId: null })} confirmText="削除" confirmColor="red" />}
            {confirmDailyDelete.isOpen && <ConfirmationModal title="リストから削除" message="この患者を本日のリストから削除しますか？マスタ登録は残ります。" onConfirm={handleConfirmDailyDelete} onCancel={() => setConfirmDailyDelete({ isOpen: false, patientId: null })} confirmText="削除" confirmColor="red" />}
            {confirmLoadModal.isOpen && <ConfirmationModal title="読み込みの確認" message="既にリストが存在します。上書きしてマスタから再読み込みしますか？" onConfirm={confirmLoadModal.onConfirm} onCancel={() => setConfirmLoadModal({ isOpen: false, onConfirm: () => { } })} confirmText="再読み込み" confirmColor="blue" />}
            {confirmClearListModal.isOpen && <ConfirmationModal title="リストの一括削除" message={`【${selectedFacility} | ${selectedDate} | ${selectedCool}クール】のリストを完全に削除します。よろしいですか？`} onConfirm={handleClearDailyList} onCancel={() => setConfirmClearListModal({ isOpen: false })} confirmText="一括削除" confirmColor="red" />}

            <div className="bg-white p-6 rounded-lg shadow-md"><h3 className="text-xl font-semibold text-gray-800 border-b pb-3 mb-4">本日の呼び出しリスト作成</h3><p className="text-gray-600 mb-4">グローバル設定（画面上部）で施設・日付・クールを選択し、下のボタンで対象患者を読み込みます。</p><button onClick={handleLoadPatients} className="w-full md:w-auto bg-green-500 hover:bg-green-600 text-white font-bold py-3 px-6 rounded-lg transition">対象患者を読み込み</button></div>
            <div className="bg-white p-6 rounded-lg shadow"><div className="flex justify-between items-center mb-4 border-b pb-2"><h3 className="text-xl font-semibold text-gray-800">リスト ({selectedCool}クール)</h3><div className="flex items-center space-x-2"><button title="臨時追加" onClick={handleOpenAddDailyModal} className="bg-orange-500 hover:bg-orange-600 text-white font-bold py-2 px-3 rounded-lg text-sm"><svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" /></svg></button><button title="リストから全削除" onClick={() => setConfirmClearListModal({ isOpen: true })} disabled={dailyList.length === 0} className="bg-red-600 hover:bg-red-700 text-white font-bold py-2 px-3 rounded-lg disabled:bg-red-300 text-sm"><svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg></button></div></div>
                {loadingDaily ? <LoadingSpinner /> : (dailyList.length > 0 ? (<div className="overflow-x-auto"><table className="min-w-full bg-white"><thead className="bg-gray-100"><tr><th className="p-2 text-left text-sm font-semibold whitespace-nowrap">操作</th><th className="p-2 text-left text-sm font-semibold whitespace-nowrap">状態</th><th className="p-2 text-left text-sm font-semibold whitespace-nowrap">ベッド番号</th><th className="p-2 text-left text-sm font-semibold whitespace-nowrap">氏名</th><th className="p-2 text-left text-sm font-semibold whitespace-nowrap">ふりがな</th></tr></thead><tbody>{dailyList.slice().sort((a, b) => { const isAExited = a.status === '退出済'; const isBExited = b.status === '退出済'; if (isAExited && !isBExited) return 1; if (!isAExited && isBExited) return -1; return a.bed.localeCompare(b.bed, undefined, { numeric: true }); }).map(p => { const masterPatient = p.masterDocId ? masterPatients.find(mp => mp.id === p.masterDocId) : masterPatients.find(mp => mp.patientId === p.masterPatientId); let isOutOfSync = false; if (masterPatient && masterPatient.updatedAt && p.updatedAt) { const hasDataDifference = p.name !== masterPatient.name || p.furigana !== masterPatient.furigana || p.bed !== masterPatient.bed || p.masterPatientId !== masterPatient.patientId; if (hasDataDifference && masterPatient.updatedAt.toDate() > p.updatedAt.toDate()) isOutOfSync = true; } return (<tr key={p.id} className="border-b hover:bg-gray-50"><td className="p-2"><div className="flex space-x-2">{isOutOfSync && <button title="マスターから更新" onClick={() => handleSyncFromMaster(p)} className="p-2 rounded bg-teal-500 hover:bg-teal-600 text-white"><svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h5M20 20v-5h-5M4 9a9 9 0 0114.13-4.13M20 15a9 9 0 01-14.13 4.13" /></svg></button>}{p.status === '治療中' && <button title="呼出" onClick={() => updatePatientStatus(selectedFacility, selectedDate, selectedCool, p.id, '呼出中')} className="p-2 rounded bg-blue-500 hover:bg-blue-600 text-white"><svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" /></svg></button>}{p.status === '呼出中' && <><button title="退出" onClick={() => updatePatientStatus(selectedFacility, selectedDate, selectedCool, p.id, '退出済')} className="p-2 rounded bg-purple-500 hover:bg-purple-600 text-white"><svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" /></svg></button><button title="キャンセル" onClick={() => updatePatientStatus(selectedFacility, selectedDate, selectedCool, p.id, '治療中')} className="p-2 rounded bg-gray-500 hover:bg-gray-600 text-white"><svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 10h10a8 8 0 018 8v2M3 10l6-6m-6 6l6 6" /></svg></button></>}{p.status === '退出済' && <button title="治療中に戻す" onClick={() => updatePatientStatus(selectedFacility, selectedDate, selectedCool, p.id, '治療中')} className="p-2 rounded bg-gray-500 hover:bg-gray-600 text-white"><svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" /></svg></button>}<button title="編集" onClick={() => handleOpenEditDailyModal(p)} className="p-2 rounded bg-yellow-500 hover:bg-yellow-600 text-white"><svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg></button><button title="削除" onClick={() => handleDeleteDailyClick(p.id)} className="p-2 rounded bg-red-500 hover:bg-red-600 text-white"><svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg></button></div></td><td className="p-2 text-sm whitespace-nowrap"><StatusBadge status={p.status} /></td><td className="p-2 text-sm whitespace-nowrap">{p.bed}</td><td className="p-2 text-sm whitespace-nowrap">{p.name}{p.isTemporary && <span className="ml-2 text-xs bg-orange-200 text-orange-800 px-2 py-0.5 rounded-full">臨時</span>}</td><td className="p-2 text-sm whitespace-nowrap">{p.furigana}</td></tr>) })}</tbody></table></div>) : <p className="text-center py-8 text-gray-500">リストが空です。上記ボタンから患者を読み込んでください。</p>)}</div>
            <div className="bg-white p-6 rounded-lg shadow"><div className="flex justify-between items-center mb-4 border-b pb-2"><h3 className="text-xl font-semibold text-gray-800">通常患者マスタ</h3><div className="flex items-center space-x-2"><input type="search" placeholder="患者ID, 氏名, ふりがなで検索" value={masterSearchTerm} onChange={(e) => setMasterSearchTerm(e.target.value)} className="p-2 border rounded-md text-sm" /><button title="患者マスタ追加" onClick={() => handleOpenMasterModal()} className="bg-blue-500 hover:bg-blue-600 text-white font-bold py-2 px-3 rounded-lg text-sm"><svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" /></svg></button><button title="QRコード一覧を生成" onClick={() => setShowQrList(true)} className="bg-teal-500 hover:bg-teal-600 text-white font-bold py-2 px-3 rounded-lg text-sm"><svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="currentColor" viewBox="0 0 16 16"><path d="M1 1h4v4H1V1z" /><path d="M2 2v2h2V2H2zM6 1h4v4H6V1zM7 2v2h2V2H7zM11 1h4v4h-4V1zm1 1v2h2V2h-2zM1 6h4v4H1V6zm1 1v2h2V7H2zM6 6h4v4H6V6zm1 1v2h2V7H7zM11 6h4v4h-4V6zm1 1v2h2V7h-2zM1 11h4v4H1v-4zm1 1v2h2v-2H2zM6 11h4v4H6v-4zm1 1v2h2v-2H7zM11 11h4v4h-4v-4zm1 1v2h2v-2h-2z" /></svg></button></div></div>{loadingMaster ? <LoadingSpinner /> : (<div className="overflow-x-auto"><table className="min-w-full bg-white"><thead className="bg-gray-100"><tr><th className="p-2 text-left text-sm font-semibold whitespace-nowrap">操作</th><th className="p-2 text-left text-sm font-semibold whitespace-nowrap">曜日</th><th className="p-2 text-left text-sm font-semibold whitespace-nowrap">クール</th><th className="p-2 text-left text-sm font-semibold whitespace-nowrap">ベッド番号</th><th className="p-2 text-left text-sm font-semibold whitespace-nowrap">氏名</th><th className="p-2 text-left text-sm font-semibold whitespace-nowrap">ふりがな</th></tr></thead><tbody>{masterPatients.length > 0 ? masterPatients.filter(p => { const term = masterSearchTerm.toLowerCase(); if (!term) return true; return (p.patientId && p.patientId.toLowerCase().includes(term)) || (p.name && p.name.toLowerCase().includes(term)) || (p.furigana && p.furigana.toLowerCase().includes(term)); }).sort((a, b) => { const dayOrder = { '月水金': 1, '火木土': 2 }; const dayCompare = (dayOrder[a.day] || 99) - (dayOrder[b.day] || 99); if (dayCompare !== 0) return dayCompare; const coolCompare = a.cool.localeCompare(b.cool, undefined, { numeric: true }); if (coolCompare !== 0) return coolCompare; return a.bed.localeCompare(b.bed, undefined, { numeric: true }); }).map(p => (<tr key={p.id} className="border-b hover:bg-gray-50"><td className="p-2"><div className="flex space-x-2"><button title="編集" onClick={() => handleOpenMasterModal(p)} className="p-2 rounded bg-yellow-500 hover:bg-yellow-600 text-white"><svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg></button><button title="削除" onClick={() => handleDeleteMasterClick(p.id)} className="p-2 rounded bg-red-500 hover:bg-red-600 text-white"><svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg></button></div></td><td className="p-2 text-sm whitespace-nowrap">{p.day}</td><td className="p-2 text-sm whitespace-nowrap">{p.cool}</td><td className="p-2 text-sm whitespace-nowrap">{p.bed}</td><td className="p-2 text-sm whitespace-nowrap">{p.name}</td><td className="p-2 text-sm whitespace-nowrap">{p.furigana}</td></tr>)) : <tr><td colSpan="6" className="text-center py-8 text-gray-500">この施設にはまだ患者が登録されていません。</td></tr>}</tbody></table></div>)}</div>
        </div>
    );
};

// --- MonitorPage ---
const MonitorPage = () => {
    const { allPatients, loading } = useAllDayPatients();
    const callingPatients = allPatients.filter(p => p.status === '呼出中').sort((a, b) => a.bed.localeCompare(b.bed, undefined, { numeric: true }));
    const treatmentPatients = allPatients.filter(p => p.status === '治療中').sort((a, b) => a.bed.localeCompare(b.bed, undefined, { numeric: true }));
    const prevCallingPatientIdsRef = useRef(new Set());
    const [isSpeaking, setIsSpeaking] = useState(false);
    const speechQueueRef = useRef([]);
    const currentAudioRef = useRef(null);
    const nowPlayingRef = useRef(null);
    const nextSpeechTimerRef = useRef(null);

    const speakNextInQueue = useCallback(() => {
        if (nextSpeechTimerRef.current) { clearTimeout(nextSpeechTimerRef.current); nextSpeechTimerRef.current = null; }
        if (speechQueueRef.current.length === 0) { setIsSpeaking(false); nowPlayingRef.current = null; return; }
        setIsSpeaking(true);
        const patient = speechQueueRef.current.shift();
        nowPlayingRef.current = patient;
        const nameToSpeak = patient.furigana || patient.name;
        const textToSpeak = `${nameToSpeak}さんのお迎えのかた、${patient.bed}番ベッドへお願いします。`;
        const functionUrl = "https://synthesizespeech-dewqhzsp5a-uc.a.run.app";
        if (!textToSpeak || textToSpeak.trim() === "") { nextSpeechTimerRef.current = setTimeout(speakNextInQueue, 1000); return; }
        fetch(functionUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: textToSpeak }), })
            .then(res => res.json()).then(data => {
                if (data.audioContent) {
                    const audio = new Audio("data:audio/mp3;base64," + data.audioContent);
                    currentAudioRef.current = audio;
                    audio.play();
                    audio.onended = () => { currentAudioRef.current = null; nextSpeechTimerRef.current = setTimeout(speakNextInQueue, 1000); };
                } else throw new Error(data.error || 'Audio content not found');
            })
            .catch((error) => { console.error("Speech synthesis failed:", error); currentAudioRef.current = null; nextSpeechTimerRef.current = setTimeout(speakNextInQueue, 1000); });
    }, []);

    useEffect(() => {
        const currentCallingIds = new Set(callingPatients.map(p => p.id));
        const prevCallingIds = prevCallingPatientIdsRef.current;
        const newPatientsToCall = callingPatients.filter(p => !prevCallingIds.has(p.id));
        if (newPatientsToCall.length > 0) { speechQueueRef.current.push(...newPatientsToCall); if (!isSpeaking) speakNextInQueue(); }
        const cancelledPatientIds = [...prevCallingIds].filter(id => !currentCallingIds.has(id));
        if (cancelledPatientIds.length > 0) {
            const cancelledIdSet = new Set(cancelledPatientIds);
            speechQueueRef.current = speechQueueRef.current.filter(p => !cancelledIdSet.has(p.id));
            if (nowPlayingRef.current && cancelledIdSet.has(nowPlayingRef.current.id)) {
                if (currentAudioRef.current) { currentAudioRef.current.pause(); currentAudioRef.current = null; }
                nowPlayingRef.current = null;
                if (nextSpeechTimerRef.current) { clearTimeout(nextSpeechTimerRef.current); nextSpeechTimerRef.current = null; }
                speakNextInQueue();
            }
        }
        prevCallingPatientIdsRef.current = currentCallingIds;
    }, [callingPatients, isSpeaking, speakNextInQueue]);

    if (loading) return <LoadingSpinner text="モニターデータを読み込み中..." />;
    return (
        <div><h2 className="text-3xl font-bold mb-6 text-center text-gray-700">呼び出しモニター</h2><div className="grid grid-cols-1 md:grid-cols-2 gap-6"><div className="bg-blue-100 p-6 rounded-lg shadow-lg"><h3 className="text-2xl font-semibold mb-4 text-blue-800 text-center">お呼び出し済み</h3><div className="space-y-3 text-center">{callingPatients.length > 0 ? callingPatients.map(p => (<p key={p.id} className="text-2xl md:text-3xl p-4 bg-white rounded-md shadow">No.{p.bed} {p.name} 様</p>)) : <p className="text-gray-500">現在、お呼び出し済みの患者さんはいません。</p>}</div></div><div className="bg-green-100 p-6 rounded-lg shadow-lg"><h3 className="text-2xl font-semibold mb-4 text-green-800 text-center">治療中</h3><div className="space-y-3 text-center">{treatmentPatients.length > 0 ? treatmentPatients.map(p => (<p key={p.id} className="text-2xl md:text-3xl p-4 bg-white rounded-md shadow">No.{p.bed} {p.name} 様</p>)) : <p className="text-gray-500">現在、治療中の患者さんはいません。</p>}</div></div></div>{isSpeaking && <div className="fixed bottom-5 right-5 bg-yellow-400 text-black font-bold py-2 px-4 rounded-full shadow-lg flex items-center"><svg className="animate-spin h-5 w-5 mr-3" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>音声再生中...</div>}</div>
    );
};

// --- StaffPage ---
const StaffPage = () => {
    const { allPatients, loading } = useAllDayPatients();
    const { selectedFacility, selectedDate } = useContext(AppContext);
    const [isScannerOpen, setScannerOpen] = useState(false);
    const actionPatients = allPatients.filter(p => p.status === '治療中' || p.status === '呼出中').sort((a, b) => a.bed.localeCompare(b.bed, undefined, { numeric: true }));

    const handleScanSuccess = useCallback((decodedText) => {
        let result;
        const patientToCall = allPatients.find(p => p.masterPatientId === decodedText && p.status === '治療中');
        if (patientToCall) {
            updatePatientStatus(selectedFacility, selectedDate, patientToCall.cool, patientToCall.id, '呼出中');
            result = { success: true, message: `${patientToCall.name} さんを呼び出しました。` };
        } else {
            const alreadyCalled = allPatients.find(p => p.masterPatientId === decodedText);
            if (alreadyCalled) { result = { success: false, message: `既にお呼び出し済みか、対象外です。` }; }
            else { result = { success: false, message: '患者が見つかりません。' }; }
        }
        return result;
    }, [allPatients, selectedFacility, selectedDate]);

    const unlockAudioManually = () => {
        [globalSuccessAudio, globalErrorAudio].forEach(audio => {
            audio.muted = true; audio.play().catch(() => {}).then(() => { audio.pause(); audio.currentTime = 0; audio.muted = false; });
        });
    };

    if (loading) return <LoadingSpinner text="呼び出しリストを読み込み中..." />;
    return (
        <div><h2 className="text-2xl font-bold mb-4">スタッフ用端末</h2>{isScannerOpen && <QrScannerModal onClose={() => setScannerOpen(false)} onScanSuccess={handleScanSuccess} />}<div className="bg-white p-6 rounded-lg shadow"><div className="flex justify-between items-center mb-4"><h3 className="text-xl font-semibold">呼び出し操作 (全クール)</h3><button onClick={() => { unlockAudioManually(); setScannerOpen(true); }} title="コード読み込み" className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold p-3 rounded-lg transition"><svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" /><path strokeLinecap="round" strokeLinejoin="round" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" /></svg></button></div><div className="overflow-x-auto">{actionPatients.length > 0 ? (<div className="space-y-3">{actionPatients.map(p => (<div key={p.id} className="flex items-center p-3 bg-gray-50 rounded-lg shadow-sm min-w-max"><div className="whitespace-nowrap pr-4 flex space-x-2">{p.status === '治療中' && <button title="呼出" onClick={() => updatePatientStatus(selectedFacility, selectedDate, p.cool, p.id, '呼出中')} className="p-3 rounded-lg bg-blue-500 hover:bg-blue-600 text-white transition"><svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" /></svg></button>}{p.status === '呼出中' && <button title="キャンセル" onClick={() => updatePatientStatus(selectedFacility, selectedDate, p.cool, p.id, '治療中')} className="p-3 rounded-lg bg-gray-500 hover:bg-gray-600 text-white transition"><svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 10h10a8 8 0 018 8v2M3 10l6-6m-6 6l6 6" /></svg></button>}</div><div className="flex items-center whitespace-nowrap"><StatusBadge status={p.status} /><span className="text-sm font-semibold bg-gray-200 text-gray-700 px-2 py-1 rounded ml-2 mr-3">{p.cool}クール</span><span className="text-lg font-medium mr-4">No.{p.bed} {p.name} 様</span></div></div>))}</div>) : <p className="text-gray-500 text-center py-4">操作対象の患者さんはいません。</p>}</div></div></div>
    );
};

// --- QRScannerModal ---
const QrScannerModal = ({ onClose, onScanSuccess }) => {
    const [scanResult, setScanResult] = useState(null);
    const isProcessingRef = useRef(false);
    const onScanSuccessRef = useRef(onScanSuccess);
    useEffect(() => { onScanSuccessRef.current = onScanSuccess; }, [onScanSuccess]);
    const [facingMode, setFacingMode] = useState('environment');

    useEffect(() => {
        const html5QrCode = new Html5Qrcode('qr-reader-container');
        const qrCodeSuccessCallback = (decodedText, decodedResult) => {
            if (isProcessingRef.current) return;
            isProcessingRef.current = true;
            const result = onScanSuccessRef.current(decodedText);
            setScanResult(result);
            try {
                const targetAudio = result.success ? globalSuccessAudio : globalErrorAudio;
                targetAudio.currentTime = 0;
                targetAudio.play().catch(e => console.error("再生エラー:", e));
            } catch (e) { console.error("Audio再生処理エラー:", e); }
            setTimeout(() => { isProcessingRef.current = false; setScanResult(null); }, 3000);
        };
        const config = { fps: 10, qrbox: { width: 250, height: 250 }, formatsToScan: [Html5QrcodeSupportedFormats.QR_CODE, Html5QrcodeSupportedFormats.CODE_128, Html5QrcodeSupportedFormats.EAN_13, Html5QrcodeSupportedFormats.CODABAR,] };
        html5QrCode.start({ facingMode: facingMode }, config, qrCodeSuccessCallback, undefined).catch(err => { console.error("スキャンの開始に失敗しました。", err); setScanResult({ success: false, message: "カメラの起動に失敗しました。" }); });
        return () => { if (html5QrCode && html5QrCode.isScanning) { html5QrCode.stop().catch(err => { console.error("スキャナの停止に失敗しました。", err); }); } };
    }, [facingMode]);

    const handleCameraSwitch = () => { setFacingMode(prev => prev === 'environment' ? 'user' : 'environment'); };
    return (
        <CustomModal title="QR/バーコードで呼び出し" onClose={onClose} footer={<button onClick={onClose} className="bg-gray-300 hover:bg-gray-400 text-gray-800 font-bold py-2 px-6 rounded-lg">閉じる</button>}>
            <div id="qr-reader-container" className="w-full"></div>
            <div className="text-center mt-3"><button onClick={handleCameraSwitch} className="bg-gray-600 hover:bg-gray-700 text-white font-bold py-2 px-4 rounded-lg transition inline-flex items-center"><svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h5M20 20v-5h-5M4 9a9 9 0 0114.13-4.13M20 15a9 9 0 01-14.13 4.13" /></svg>カメラ切替</button></div>
            <div className={`mt-4 p-3 rounded text-center font-semibold transition-colors duration-300 ${scanResult ? (scanResult.success ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800') : 'bg-gray-100 text-gray-600'}`}>{scanResult ? scanResult.message : 'QRコードをかざしてください'}</div>
        </CustomModal>
    );
};

// --- DriverPage ---
const DriverPage = () => {
    const { allPatients, loading } = useAllDayPatients();
    const callingPatients = allPatients.filter(p => p.status === '呼出中').sort((a, b) => a.bed.localeCompare(b.bed, undefined, { numeric: true }));
    if (loading) return <LoadingSpinner text="送迎リストを読み込み中..." />;
    return (
        <div><h2 className="text-2xl font-bold mb-4">送迎担当者用画面</h2><div className="bg-white p-6 rounded-lg shadow"><h3 className="text-xl font-semibold mb-4">お呼び出し済みの患者様</h3>{callingPatients.length > 0 ? (<div className="space-y-3">{callingPatients.map(p => (<div key={p.id} className="p-4 bg-blue-100 rounded-lg text-blue-800 font-semibold text-lg">No.{p.bed} {p.name} 様</div>))}</div>) : (<p className="text-gray-500 text-center py-4">現在、お呼び出し済みの患者さんはいません。</p>)}</div></div>
    );
};


// ==========================================================================================
// 4. 入院透析室用コンポーネント
// ==========================================================================================

const totalBeds = 20;
const ItemTypes = { BED: 'bed' };
const ALL_BED_STATUSES = ['空床', '入室可能', '入室連絡済', '治療中', '送迎可能', '退室連絡済'];

const BedButton = ({ bedNumber, left, top }) => {
    const [{ isDragging }, drag] = useDrag(() => ({
        type: ItemTypes.BED,
        item: { bedNumber, left, top },
        collect: (monitor) => ({ isDragging: monitor.isDragging(), }),
    }), [bedNumber, left, top]);
    const opacity = isDragging ? 0.4 : 1;
    return <div ref={drag} style={{ position: 'absolute', left, top, opacity, cursor: 'move' }} className="p-3 bg-blue-500 text-white rounded-lg font-bold shadow-md w-20 h-16 flex justify-center items-center">{bedNumber}</div>;
};

// --- LayoutEditor ---
const LayoutEditor = ({ onSaveComplete, initialPositions }) => {
    const { selectedFacility } = useContext(AppContext);
    const [bedPositions, setBedPositions] = useState(initialPositions);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState(null);
    const layoutDocRef = doc(db, 'bedLayouts', selectedFacility);
    const GRID_SNAP_X = 90; const GRID_SNAP_Y = 100; const OFFSET_X = 10; const OFFSET_Y = 50; const BED_WIDTH = 80; const BED_HEIGHT = 64;

    const [, drop] = useDrop(() => ({
        accept: ItemTypes.BED,
        drop(item, monitor) {
            const delta = monitor.getDifferenceFromInitialOffset();
            if (!delta) return;
            const newLeft = Math.round((item.left + delta.x - OFFSET_X) / GRID_SNAP_X) * GRID_SNAP_X + OFFSET_X;
            const newTop = Math.round((item.top + delta.y - OFFSET_Y) / GRID_SNAP_Y) * GRID_SNAP_Y + OFFSET_Y;
            const draggedBedNumber = item.bedNumber;
            const originalPos = { top: item.top, left: item.left };

            setBedPositions(currentPositions => {
                const targetBedEntry = Object.entries(currentPositions).find(([num, pos]) => {
                    if (num === draggedBedNumber) return false;
                    return (newLeft < pos.left + BED_WIDTH && newLeft + BED_WIDTH > pos.left && newTop < pos.top + BED_HEIGHT && newTop + BED_HEIGHT > pos.top);
                });
                if (targetBedEntry) {
                    const [targetNum, targetPos] = targetBedEntry;
                    const newPositions = { ...currentPositions };
                    newPositions[targetNum] = originalPos;
                    newPositions[draggedBedNumber] = targetPos;
                    return newPositions;
                } else {
                    return { ...currentPositions, [draggedBedNumber]: { top: newTop, left: newLeft }, };
                }
            });
        },
    }), []);

    const handleSaveLayout = async () => {
        setSaving(true); setError(null);
        try { await setDoc(layoutDocRef, { positions: bedPositions }); if (onSaveComplete) onSaveComplete(); }
        catch (err) { console.error("レイアウトの保存に失敗:", err); setError("保存に失敗しました。"); }
        setSaving(false);
    };

    return (
        <div className="p-4 border rounded-lg bg-gray-50">
            <div className="flex justify-between items-center mb-4"><h3 className="text-lg font-bold">ベッド配置エディタ</h3><button onClick={handleSaveLayout} disabled={saving} title={saving ? "保存中..." : "レイアウトを保存"} className="font-bold p-3 rounded-lg transition bg-green-600 hover:bg-green-700 text-white disabled:bg-gray-400">{saving ? <svg className="animate-spin h-6 w-6" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg> : <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" /></svg>}</button></div>
            {error && <p className="text-red-500 text-center mb-4">{error}</p>}
            <p className="text-sm text-gray-600 mb-4">ベッド（青い箱）をドラッグして配置を調整し、「レイアウトを保存」ボタンを押してください。</p>
            <div ref={drop} className="relative w-full h-[400px] bg-white border-2 border-dashed border-gray-400 rounded-lg overflow-auto">
                {bedPositions && Object.entries(bedPositions).map(([bedNumber, { top, left }]) => (<BedButton key={bedNumber} bedNumber={bedNumber} left={left} top={top} />))}
            </div>
        </div>
    );
};

// --- useBedData Hook ---
const useBedData = (currentPage) => {
  const { selectedFacility, selectedDate } = useContext(AppContext);
  const [bedLayout, setBedLayout] = useState(null);
  const [bedStatuses, setBedStatuses] = useState(null); 
  const [layoutLoading, setLayoutLoading] = useState(true);
  const [statusLoading, setStatusLoading] = useState(true);
  const [error, setError] = useState(null);
  
  const [logs, setLogs] = useState([]);

  const layoutDocRef = useMemo(() => doc(db, 'bedLayouts', selectedFacility), [selectedFacility]);
  const statusCollectionRef = useMemo(() => collection(db, 'bed_statuses', `${selectedFacility}_${selectedDate}`, 'beds'), [selectedFacility, selectedDate]);
  
  // 1. レイアウトの購読
  useEffect(() => {
    setLayoutLoading(true); 
    const unsubscribe = onSnapshot(layoutDocRef, (docSnap) => {
      if (docSnap.exists() && docSnap.data().positions) {
        setBedLayout(docSnap.data().positions);
      } else {
        const initialPositions = {};
        for (let i = 1; i <= totalBeds; i++) {
          const row = i <= 10 ? 0 : 1;
          const col = i <= 10 ? i - 1 : i - 11;
          initialPositions[i.toString()] = { top: 50 + row * 100, left: 10 + col * 90 };
        }
        setBedLayout(initialPositions);
      }
      setLayoutLoading(false);
    }, (err) => { console.error("レイアウトの購読に失敗:", err); setError("レイアウトの読み込みに失敗しました。"); setLayoutLoading(false); });
    return () => unsubscribe();
  }, [layoutDocRef]); 

  // 2. ステータスの購読
  useEffect(() => {
    setStatusLoading(true); 
    const q = query(statusCollectionRef);
    const unsubscribe = onSnapshot(q, async (querySnapshot) => {
      if (querySnapshot.empty) {
        console.log("初期化します。");
        const initialStatuses = {};
        const batch = writeBatch(db);
        for (let i = 1; i <= totalBeds; i++) {
          const bedNumStr = i.toString();
          const bedDocRef = doc(statusCollectionRef, bedNumStr);
          batch.set(bedDocRef, { status: "空床" });
          initialStatuses[bedNumStr] = "空床";
        }
        try { await batch.commit(); setBedStatuses(initialStatuses); } catch (err) { console.error("初期化失敗:", err); setError("初期化に失敗しました。"); }
      } else {
        const newStatuses = {};
        querySnapshot.forEach((doc) => { newStatuses[doc.id] = doc.data().status; });
        setBedStatuses(newStatuses); 
      }
      setStatusLoading(false); 
    }, (err) => { console.error("ステータス購読失敗:", err); setError("ステータスの読み込みに失敗しました。"); setStatusLoading(false); });
    return () => unsubscribe();
  }, [statusCollectionRef]); 

  // 3. クリック処理 (スタッフ用 - QRコード自動処理用)
  const handleBedTap = useCallback(async (bedNumber) => {
    const bedNumStr = bedNumber.toString();
    if (!bedStatuses) return;
    const currentStatus = bedStatuses[bedNumStr] || '空床'; 
    let newStatus = currentStatus;
    
    // 循環フロー (QRコード用ロジックとして維持)
    if (currentStatus === '空床') { newStatus = '入室可能'; }
    else if (currentStatus === '入室可能') { newStatus = '入室連絡済'; }
    else if (currentStatus === '入室連絡済') { newStatus = '治療中'; }
    else if (currentStatus === '治療中') { newStatus = '送迎可能'; }
    else if (currentStatus === '送迎可能') { newStatus = '治療中'; } 
    else if (currentStatus === '退室連絡済') { newStatus = '空床'; }

    if (newStatus !== currentStatus) {
      const bedDocRef = doc(statusCollectionRef, bedNumStr);
      try { await updateDoc(bedDocRef, { status: newStatus }); } catch (err) { console.error("更新失敗:", err); alert("更新に失敗しました。"); }
    }
  }, [bedStatuses, statusCollectionRef]);

  // 4. クリック処理 (管理者用 - 循環フロー)
  const handleAdminBedTap = useCallback(async (bedNumber) => {
    const bedNumStr = bedNumber.toString();
    if (!bedStatuses) return;
    const currentStatus = bedStatuses[bedNumStr] || '空床';
    let newStatus = currentStatus;
    
    // 循環フロー (維持するがUIでは使用しない方向へ)
    if (currentStatus === '空床') { newStatus = '入室可能'; }
    else if (currentStatus === '入室可能') { newStatus = '入室連絡済'; }
    else if (currentStatus === '入室連絡済') { newStatus = '治療中'; }
    else if (currentStatus === '治療中') { newStatus = '送迎可能'; }
    else if (currentStatus === '送迎可能') { newStatus = '退室連絡済'; }
    else if (currentStatus === '退室連絡済') { newStatus = '空床'; }

    if (newStatus !== currentStatus) {
      const bedDocRef = doc(statusCollectionRef, bedNumStr);
      try { await updateDoc(bedDocRef, { status: newStatus }); } catch (err) { console.error("更新失敗:", err); alert("更新に失敗しました。"); }
    }
  }, [bedStatuses, statusCollectionRef]);

  // ★ 5. 直接指定更新処理 (新UI用)
  const updateBedStatusDirectly = useCallback(async (bedNumber, newStatus) => {
      const bedNumStr = bedNumber.toString();
      const bedDocRef = doc(statusCollectionRef, bedNumStr);
      try { await updateDoc(bedDocRef, { status: newStatus }); } catch (err) { console.error("更新失敗:", err); alert("更新に失敗しました。"); }
  }, [statusCollectionRef]);

  const handleResetAll = useCallback(async () => {
    const batch = writeBatch(db);
    for (let i = 1; i <= totalBeds; i++) {
      const bedDocRef = doc(statusCollectionRef, i.toString());
      batch.update(bedDocRef, { status: "空床" });
    }
    try { await batch.commit(); } catch (err) { console.error("全リセット失敗:", err); alert("リセットに失敗しました。"); }
  }, [statusCollectionRef]);

  // 6. 音声通知機能 & ログ機能
  const prevStatusesRef = useRef(null); 
  const isPlayingRef = useRef(false); 
  const speechQueueRef = useRef([]); 
  const currentAudioRef = useRef(null);
  const nextSpeechTimerRef = useRef(null);
  const nowPlayingRef = useRef(null); 

  const speakNextInQueue = useCallback(() => {
    if (nextSpeechTimerRef.current) { clearTimeout(nextSpeechTimerRef.current); nextSpeechTimerRef.current = null; }
    
    if (speechQueueRef.current.length === 0) { 
        isPlayingRef.current = false;
        nowPlayingRef.current = null; 
        return; 
    }

    if (isPlayingRef.current && nowPlayingRef.current) {
        return;
    }

    isPlayingRef.current = true;
    
    const bedNumber = speechQueueRef.current.shift(); 
    nowPlayingRef.current = bedNumber; 
    const textToSpeak = `${bedNumber}番ベッド、送迎可能です。`;
    const functionUrl = "https://synthesizespeech-dewqhzsp5a-uc.a.run.app"; 

    fetch(functionUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: textToSpeak }), })
    .then(res => res.json()).then(data => {
      if (data.audioContent) {
        const audio = new Audio("data:audio/mp3;base64," + data.audioContent);
        currentAudioRef.current = audio;
        audio.play();
        audio.onended = () => { 
            currentAudioRef.current = null; 
            nowPlayingRef.current = null;
            nextSpeechTimerRef.current = setTimeout(() => {
                isPlayingRef.current = false; 
                speakNextInQueue();
            }, 1000); 
        };
      } else throw new Error(data.error || 'Audio content not found');
    }).catch((error) => { 
        console.error("Speech synthesis failed:", error); 
        currentAudioRef.current = null; 
        nowPlayingRef.current = null;
        isPlayingRef.current = false;
        nextSpeechTimerRef.current = setTimeout(speakNextInQueue, 1000); 
    });
  }, []);

  useEffect(() => {
    if (!bedStatuses) return; 
    const prevStatuses = prevStatusesRef.current; 
    if (prevStatuses) { 
      const newCalls = []; 
      const cancelledBeds = []; 
      let shouldPlayEnterSound = false; 
      
      const newLogs = [];
      const now = new Date();
      // ★ 修正: 時刻フォーマットを hh:mm:ss に変更
      const timeStr = now.toLocaleTimeString('ja-JP', { hour12: false }); 

      for (let i = 1; i <= totalBeds; i++) {
        const bedNumStr = i.toString();
        const currentStatus = bedStatuses[bedNumStr];
        const previousStatus = prevStatuses[bedNumStr];
        
        // 送迎可能になった場合
        if ((previousStatus === '治療中' || previousStatus === '退室連絡済') && currentStatus === '送迎可能') { 
            newCalls.push(bedNumStr); 
            newLogs.push({ time: timeStr, message: `No.${bedNumStr} 送迎可能` });
        }
        
        // キャンセル判定
        if (previousStatus === '送迎可能' && currentStatus !== '送迎可能') { 
            cancelledBeds.push(bedNumStr); 
        }

        // 入室可能になった場合
        if (previousStatus === '空床' && currentStatus === '入室可能') {
            shouldPlayEnterSound = true;
            newLogs.push({ time: timeStr, message: `No.${bedNumStr} 入室可能` });
        }
      }

      if (newLogs.length > 0) {
          setLogs(prev => [...newLogs, ...prev].slice(0, 100)); 
      }

      // キャンセル処理
      if (cancelledBeds.length > 0) {
        const cancelledBedSet = new Set(cancelledBeds);
        speechQueueRef.current = speechQueueRef.current.filter(bedNum => !cancelledBedSet.has(bedNum));
        if (nowPlayingRef.current && cancelledBedSet.has(nowPlayingRef.current)) {
          if (currentAudioRef.current) { currentAudioRef.current.pause(); currentAudioRef.current = null; }
          if (nextSpeechTimerRef.current) { clearTimeout(nextSpeechTimerRef.current); nextSpeechTimerRef.current = null; }
          nowPlayingRef.current = null; 
          isPlayingRef.current = false;
          speakNextInQueue();
        }
      }

      // 新規読み上げ追加
      if (newCalls.length > 0) {
        newCalls.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
        speechQueueRef.current.push(...newCalls);
        if (!isPlayingRef.current && currentPage === 'admin') { speakNextInQueue(); }
      }

      // 入室可能通知音の再生
      if (shouldPlayEnterSound && currentPage === 'admin') {
          const audio = new Audio('/sounds/enter.mp3'); 
          audio.volume = 0.5; 
          audio.play().catch(e => console.error("SE再生エラー", e));
      }
    }
    prevStatusesRef.current = bedStatuses;
  }, [bedStatuses, speakNextInQueue, currentPage]);
  
  useEffect(() => { return () => { if (currentAudioRef.current) { currentAudioRef.current.pause(); currentAudioRef.current = null; } if (nextSpeechTimerRef.current) { clearTimeout(nextSpeechTimerRef.current); nextSpeechTimerRef.current = null; } speechQueueRef.current = []; isPlayingRef.current = false; nowPlayingRef.current = null; }; }, []);

  const isLoading = layoutLoading || statusLoading;
  return { bedLayout, bedStatuses, loading: isLoading, error, handleBedTap, handleAdminBedTap, updateBedStatusDirectly, handleResetAll, isSpeaking: isPlayingRef.current, logs };
};

// --- スタイル定義 ---
const getBedStatusStyle = (status) => {
    switch (status) {
        case '送迎可能': return 'bg-yellow-400 text-black'; 
        case '退室連絡済': return 'bg-orange-400 text-white';
        case '治療中': return 'bg-green-600 text-white';
        case '入室連絡済': return 'bg-pink-400 text-white';
        case '入室可能': return 'bg-blue-500 text-white';
        case '空床': default: return 'bg-gray-400 text-white';
    }
};

// --- LogPanel ---
const LogPanel = ({ logs }) => {
    // メッセージ内容に応じて背景色を決定するヘルパー関数
    const getLogStyle = (message) => {
        if (message.includes('入室可能')) return 'bg-blue-100';   // 入室可能なら薄い青
        if (message.includes('送迎可能')) return 'bg-yellow-100'; // 送迎可能なら薄い黄色
        return '';
    };

    return (
        <div className="bg-white p-2 rounded-lg shadow border border-gray-200 flex-shrink-0 w-full md:w-48">
            <h3 className="text-xs font-bold mb-2 text-gray-800 border-b pb-1 sticky top-0 bg-white z-10">ログ</h3>
            <div className="h-[350px] overflow-y-auto">
                {logs.length === 0 ? (
                    <p className="text-[10px] text-gray-400 text-center mt-4">履歴なし</p>
                ) : (
                    <ul className="space-y-1">
                        {logs.map((log, i) => (
                            <li key={i} className={`text-[13px] text-gray-700 border-b border-gray-50 last:border-0 py-1 px-1 rounded leading-none ${getLogStyle(log.message)}`}>
                                <span className="font-mono font-semibold mr-1 text-blue-600 block">{log.time}</span>
                                {log.message}
                            </li>
                        ))}
                    </ul>
                )}
            </div>
        </div>
    );
};

// --- StatusSelectionPopover ---
const StatusSelectionPopover = ({ currentStatus, onSelect, onClose, align }) => {
    // 位置調整用のクラスを生成
    let positionClass = 'left-1/2 -translate-x-1/2'; // デフォルト: 中央
    let triangleClass = 'left-1/2 -translate-x-1/2';
    
    if (align === 'left') {
        positionClass = 'left-0'; // 左寄せ
        triangleClass = 'left-8'; // ツノも左寄りに（ボタンの中心付近）
    } else if (align === 'right') {
        positionClass = 'right-0'; // 右寄せ
        triangleClass = 'right-8'; // ツノも右寄りに
    }

    return (
        <div className={`absolute top-full mt-2 z-50 bg-white shadow-xl rounded-lg p-2 flex gap-2 border border-gray-200 ${positionClass} before:content-[''] before:absolute before:bottom-full before:border-8 before:border-transparent before:border-b-white ${triangleClass.startsWith('left') ? `before:left-8` : (triangleClass.startsWith('right') ? `before:right-8` : `before:left-1/2 before:-translate-x-1/2`)}`}>
            {/* Header removed */}
            {ALL_BED_STATUSES.map(status => (
                <button
                    key={status}
                    onClick={(e) => {
                        e.stopPropagation();
                        onSelect(status);
                    }}
                    className={`w-20 h-16 flex items-center justify-center text-xs font-bold rounded-lg shadow-md transition ${status === currentStatus ? 'ring-2 ring-offset-2 ring-blue-500 scale-105' : 'hover:scale-105 opacity-90 hover:opacity-100'} ${getBedStatusStyle(status)}`}
                >
                    {status}
                </button>
            ))}
            {/* Footer removed */}
        </div>
    );
};

// --- InpatientAdminPage ---
const InpatientAdminPage = ({ bedLayout, bedStatuses, updateBedStatusDirectly, handleResetAll, isSpeaking, onShowQrPage, logs }) => {
  const [isLayoutEditMode, setIsLayoutEditMode] = useState(false);
  const [confirmResetModal, setConfirmResetModal] = useState(false);
  const [selectedBedId, setSelectedBedId] = useState(null); // ポップオーバー表示用
  
  const onConfirmReset = () => { handleResetAll(); setConfirmResetModal(false); };

  // 背景クリックでポップオーバーを閉じるためのハンドラ
  useEffect(() => {
      const handleClickOutside = () => setSelectedBedId(null);
      if (selectedBedId) {
          window.addEventListener('click', handleClickOutside);
      }
      return () => window.removeEventListener('click', handleClickOutside);
  }, [selectedBedId]);

  return (
    <div className="space-y-6">
      {confirmResetModal && <ConfirmationModal title="全ベッドのリセット確認" message="すべてのベッドを初期状態（空床）に戻します。よろしいですか？" onConfirm={onConfirmReset} onCancel={() => setConfirmResetModal(false)} confirmText="リセット実行" confirmColor="red" />}
      <div className="flex justify-between items-center bg-white p-4 rounded-lg shadow"><h2 className="text-2xl font-bold">管理・モニター画面</h2><div className="flex items-center space-x-2">
          <button onClick={onShowQrPage} title="ベッド用QRコード発行" className="font-bold p-3 rounded-lg transition bg-teal-500 hover:bg-teal-600 text-white"><svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="currentColor" viewBox="0 0 16 16"><path d="M1 1h4v4H1V1z" /><path d="M2 2v2h2V2H2zM6 1h4v4H6V1zM7 2v2h2V2H7zM11 1h4v4h-4V1zm1 1v2h2V2h-2zM1 6h4v4H1V6zm1 1v2h2V7H2zM6 6h4v4H6V6zm1 1v2h2V7H7zM11 6h4v4h-4V6zm1 1v2h2V7h-2zM1 11h4v4H1v-4zm1 1v2h2v-2H2zM6 11h4v4H6v-4zm1 1v2h2v-2H7zM11 11h4v4h-4v-4zm1 1v2h2v-2h-2z" /></svg></button>
          <button onClick={() => setConfirmResetModal(true)} title="全ベッドリセット" className="font-bold p-3 rounded-lg transition bg-red-600 hover:bg-red-700 text-white"><svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h5M20 20v-5h-5M4 9a9 9 0 0114.13-4.13M20 15a9 9 0 01-14.13 4.13" /></svg></button>
          <button onClick={() => setIsLayoutEditMode(!isLayoutEditMode)} title={isLayoutEditMode ? "編集を終了" : "ベッド配置を編集"} className={`font-bold p-3 rounded-lg transition ${isLayoutEditMode ? 'bg-gray-600 hover:bg-gray-700' : 'bg-yellow-500 hover:bg-yellow-600'} text-white`}>{isLayoutEditMode ? <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg> : <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>}</button>
      </div></div>
      
      {/* ベッド配置図とログの横並びレイアウト */}
      <div className="flex flex-col md:flex-row gap-4">
        <div className="flex-grow">
          {isLayoutEditMode ? (
            <LayoutEditor onSaveComplete={() => setIsLayoutEditMode(false)} initialPositions={bedLayout} />
          ) : (
            <div className="relative w-full min-h-[400px] bg-white p-4 border rounded-lg shadow-inner overflow-auto">
              {bedLayout && bedStatuses && Object.entries(bedLayout).map(([bedNumber, { top, left }]) => { 
                const status = bedStatuses[bedNumber] || '空床'; 
                const statusStyle = getBedStatusStyle(status); 
                
                // ポップオーバー位置の決定ロジック
                let popoverAlign = 'center';
                if (left < 200) popoverAlign = 'left';
                else if (left > 600) popoverAlign = 'right';

                return (
                  <div key={bedNumber} style={{ position: 'absolute', top, left }} className="z-10">
                      <button 
                        className={`p-1 rounded-lg font-bold shadow-md w-20 h-16 flex flex-col justify-center items-center transition-colors duration-300 ${statusStyle} cursor-pointer hover:brightness-90`} 
                        onClick={(e) => {
                            e.stopPropagation(); // 親への伝播を防ぐ
                            setSelectedBedId(selectedBedId === bedNumber ? null : bedNumber);
                        }}
                      >
                        <span className="text-xl leading-none">{bedNumber}</span>
                        <span className="text-[10px] leading-tight mt-1">{status}</span>
                      </button>
                      
                      {/* ポップオーバーの表示 */}
                      {selectedBedId === bedNumber && (
                          <StatusSelectionPopover 
                              currentStatus={status} 
                              onSelect={(newStatus) => {
                                  updateBedStatusDirectly(bedNumber, newStatus);
                                  setSelectedBedId(null);
                              }}
                              onClose={() => setSelectedBedId(null)}
                              align={popoverAlign} // 位置情報を渡す
                          />
                      )}
                  </div>
                ); 
              })}
            </div>
          )}
        </div>
        
        {/* ログパネルを右側に配置 */}
        {!isLayoutEditMode && <LogPanel logs={logs} />}
      </div>

      {isSpeaking && <div className="fixed bottom-5 right-5 bg-yellow-400 text-black font-bold py-2 px-4 rounded-full shadow-lg flex items-center z-50"><svg className="animate-spin h-5 w-5 mr-3" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>音声再生中...</div>}
    </div>
  );
};

// --- CompactQrScanner ---
const CompactQrScanner = ({ onScanSuccess }) => {
    const [scanResult, setScanResult] = useState(null); 
    const isProcessingRef = useRef(false); 
    const onScanSuccessRef = useRef(onScanSuccess);
    useEffect(() => { onScanSuccessRef.current = onScanSuccess; }, [onScanSuccess]);
    const [facingMode, setFacingMode] = useState('environment'); 

    useEffect(() => {
        const timer = setTimeout(() => {
            const html5QrCode = new Html5Qrcode('qr-reader-compact');
            const qrCodeSuccessCallback = (decodedText, decodedResult) => {
                if (isProcessingRef.current) return;
                isProcessingRef.current = true;
                const result = onScanSuccessRef.current(decodedText);
                setScanResult(result); 
                try {
                    const targetAudio = result.success ? globalSuccessAudio : globalErrorAudio;
                    targetAudio.currentTime = 0; targetAudio.play().catch(e => console.error("再生エラー:", e));
                } catch (e) { console.error("Audio再生処理エラー:", e); }
                setTimeout(() => { isProcessingRef.current = false; setTimeout(() => setScanResult(null), 1000); }, 3000);
            };
            const config = { fps: 10, qrbox: { width: 110, height: 110 }, formatsToScan: [Html5QrcodeSupportedFormats.QR_CODE, Html5QrcodeSupportedFormats.CODE_128, Html5QrcodeSupportedFormats.EAN_13, Html5QrcodeSupportedFormats.CODABAR] };
            html5QrCode.start({ facingMode: facingMode }, config, qrCodeSuccessCallback, undefined).catch(err => { console.error("スキャン開始エラー:", err); setScanResult({ success: false, message: "カメラ起動失敗" }); });
            return () => { if (html5QrCode && html5QrCode.isScanning) { html5QrCode.stop().then(() => html5QrCode.clear()).catch(console.error); } };
        }, 100);
        return () => clearTimeout(timer); 
    }, [facingMode]);

    return (
        <div className="flex w-full h-32 bg-white border border-gray-300 rounded-lg shadow-sm overflow-hidden mb-4">
            <div className="relative w-40 bg-black flex-shrink-0">
                <div id="qr-reader-compact" className="w-full h-full opacity-90" style={{ objectFit: 'cover' }}></div>
                <div className="absolute top-2 left-2 w-3 h-3 bg-green-500 rounded-full animate-pulse border border-white z-10" title="カメラ動作中"></div>
                <button onClick={() => setFacingMode(prev => prev === 'environment' ? 'user' : 'environment')} className="absolute bottom-1 right-1 bg-gray-800 bg-opacity-70 text-white text-[10px] px-2 py-1 rounded border border-gray-600 z-10">切替</button>
            </div>
            <div className={`flex-1 flex flex-col justify-center items-center p-2 text-center transition-colors duration-300 ${scanResult ? (scanResult.success ? 'bg-green-100' : 'bg-red-100') : 'bg-gray-50'}`}>
                {scanResult ? (<><div className={`text-2xl font-bold mb-1 ${scanResult.success ? 'text-green-700' : 'text-red-700'}`}>{scanResult.success ? 'OK!' : 'NG'}</div><p className={`text-2xl font-bold leading-tight ${scanResult.success ? 'text-green-800' : 'text-red-800'}`}>{scanResult.message}</p></>) : (<><p className="text-gray-400 font-bold text-lg mb-1">SCANNING...</p><p className="text-xs text-gray-500">コードをかざしてください</p></>)}
            </div>
        </div>
    );
};

// --- InpatientStaffPage ---
const InpatientStaffPage = ({ bedLayout, bedStatuses, handleBedTap, updateBedStatusDirectly }) => {
  const [selectedBedId, setSelectedBedId] = useState(null);

  // 背景クリックでポップオーバーを閉じる
  useEffect(() => {
    const handleClickOutside = () => setSelectedBedId(null);
    if (selectedBedId) { window.addEventListener('click', handleClickOutside); }
    return () => window.removeEventListener('click', handleClickOutside);
  }, [selectedBedId]);

  const handleScanSuccess = useCallback((decodedText) => {
    const bedNumber = parseInt(decodedText, 10);
    if (bedNumber >= 1 && bedNumber <= totalBeds) {
      const bedNumStr = bedNumber.toString();
      if (bedStatuses && bedStatuses[bedNumStr] === '治療中') {
        handleBedTap(bedNumStr); 
        return { success: true, message: `No.${bedNumStr} 送迎可能` }; 
      } else if (bedStatuses && bedStatuses[bedNumStr] !== '治療中') {
        return { success: false, message: `No.${bedNumStr} 対象外` }; 
      } else { return { success: false, message: "取得エラー" }; }
    } else { return { success: false, message: `無効コード` }; }
  }, [bedStatuses, handleBedTap]);

  return (
    <div>
      <div className="flex justify-between items-center bg-white p-4 rounded-lg shadow mb-4 sticky top-0 z-20"><h2 className="text-2xl font-bold text-gray-800">スタッフ操作</h2><div className="text-sm text-gray-500 font-medium">リスト・カメラ同期中</div></div>
      <CompactQrScanner onScanSuccess={handleScanSuccess} />
      <div className="relative w-full min-h-[400px] bg-white p-4 border rounded-lg shadow-inner overflow-auto">
        {bedLayout && bedStatuses && Object.entries(bedLayout).map(([bedNumber, { top, left }]) => {
          const status = bedStatuses[bedNumber] || '空床';
          const statusStyle = getBedStatusStyle(status);

          // ポップオーバー位置の決定ロジック
          let popoverAlign = 'center';
          if (left < 200) popoverAlign = 'left';
          else if (left > 600) popoverAlign = 'right';

          return (
            <div key={bedNumber} style={{ position: 'absolute', top, left }} className="z-10">
                <button 
                    className={`p-1 rounded-lg font-bold shadow-md w-20 h-16 flex flex-col justify-center items-center transition-colors duration-300 ${statusStyle} cursor-pointer hover:brightness-90`} 
                    onClick={(e) => {
                        e.stopPropagation();
                        setSelectedBedId(selectedBedId === bedNumber ? null : bedNumber);
                    }}
                >
                    <span className="text-xl leading-none">{bedNumber}</span>
                    <span className="text-[10px] leading-tight mt-1">{status}</span>
                </button>
                {selectedBedId === bedNumber && (
                    <StatusSelectionPopover 
                        currentStatus={status} 
                        onSelect={(newStatus) => {
                            updateBedStatusDirectly(bedNumber, newStatus);
                            setSelectedBedId(null);
                        }}
                        onClose={() => setSelectedBedId(null)}
                        align={popoverAlign} // 位置情報を渡す
                    />
                )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

// --- InpatientView ---
const InpatientView = ({ user, onGoBack }) => {
    const [currentPage, setCurrentPage] = useState(isMobileDevice() ? 'staff' : 'admin');
    const [showQrPage, setShowQrPage] = useState(false); 
    const hideCoolSelector = true;

    const { bedLayout, bedStatuses, loading, error, handleBedTap, handleAdminBedTap, updateBedStatusDirectly, handleResetAll, isSpeaking, logs } = useBedData(currentPage);
    const NavButton = ({ page, label }) => (<button onClick={() => setCurrentPage(page)} className={`px-3 py-2 sm:px-4 rounded-lg font-medium transition duration-200 text-sm sm:text-base ${currentPage === page ? 'bg-blue-600 text-white shadow-md' : 'bg-white text-gray-700 hover:bg-gray-200'}`}>{label}</button>);

    const renderPages = () => {
        if (showQrPage) return <InpatientQrCodePage onBack={() => setShowQrPage(false)} />;
        if (loading) return <LoadingSpinner text="入院透析室データを読み込み中..." />;
        if (error) return <p className="text-red-500 text-center">{error}</p>;
        return (
            <>{currentPage === 'admin' && <InpatientAdminPage bedLayout={bedLayout} bedStatuses={bedStatuses} updateBedStatusDirectly={updateBedStatusDirectly} handleResetAll={handleResetAll} isSpeaking={isSpeaking} onShowQrPage={() => setShowQrPage(true)} logs={logs} />}{currentPage === 'staff' && <InpatientStaffPage bedLayout={bedLayout} bedStatuses={bedStatuses} handleBedTap={handleBedTap} updateBedStatusDirectly={updateBedStatusDirectly} />}</>
        );
    };

    return (<AppLayout user={user} onGoBack={onGoBack} hideCoolSelector={hideCoolSelector} navButtons={<>{!showQrPage && <><NavButton page="admin" label="管理/モニター" /><NavButton page="staff" label="スタッフ" /></>}</>}>{renderPages()}</AppLayout>);
};

// --- InpatientQrCodePage ---
const QrCodeCard = ({ bedNumber }) => {
    const qrSize = 112; const value = bedNumber.toString();
    return (<div className="w-[10cm] h-[7.5cm] border border-gray-400 bg-white rounded-lg p-4 flex flex-row justify-center items-center break-inside-avoid mb-4"><div className="flex-1 flex flex-col items-center justify-center h-full"><h3 className="text-lg font-bold mb-2">ベッド番号: {bedNumber}</h3><QRCodeSVG value={value} size={qrSize} /></div><div className="h-full border-l-2 border-dashed border-gray-400"></div><div className="flex-1 flex flex-col items-center justify-center h-full"><h3 className="text-lg font-bold mb-2">ベッド番号: {bedNumber}</h3><QRCodeSVG value={value} size={qrSize} /></div></div>);
};

const InpatientQrCodePage = ({ onBack }) => {
    const { selectedFacility } = useContext(AppContext);
    const bedNumbers = Array.from({ length: totalBeds }, (_, i) => i + 1);
    const handlePrint = () => { window.print(); };
    return (
        <div className="bg-gray-100">
            <style>{`@media print { body { margin: 0; padding: 0; background-color: white !important; } nav, .app-layout-padding, .print-header { display: none !important; } .print-content { margin: 0 !important; padding: 0 !important; background-color: white !important; box-shadow: none !important; } .qr-card { break-inside: avoid; page-break-inside: avoid; } .print-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }`}</style>
            <div className="print-header bg-white p-4 rounded-lg shadow mb-6 flex justify-between items-center"><div><h2 className="text-2xl font-bold">入院透析室 QRコード一覧</h2><p className="text-gray-600">{selectedFacility} (ベッド 1～20)</p></div><div className="flex space-x-2"><button onClick={onBack} title="戻る" className="font-bold p-3 rounded-lg transition bg-gray-500 hover:bg-gray-600 text-white"><svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg></button><button onClick={handlePrint} title="印刷" className="font-bold p-3 rounded-lg transition bg-blue-600 hover:bg-blue-700 text-white"><svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm7-8a1 1 0 01-1-1V5a1 1 0 00-1-1H9a1 1 0 00-1 1v6a1 1 0 01-1 1" /></svg></button></div></div>
            <div className="print-content bg-white p-4 rounded-lg shadow-inner grid grid-cols-1 md:print-grid md:grid-cols-2 gap-4">{bedNumbers.map(bedNum => (<div key={bedNum} className="qr-card flex justify-center"><QrCodeCard bedNumber={bedNum} /></div>))}</div>
        </div>
    );
};

// ==========================================================================================
// 5. アプリケーション全体レイアウト・ルーティング
// ==========================================================================================

const GlobalControls = ({ hideCoolSelector = false }) => {
    const { selectedFacility, setSelectedFacility, selectedDate, setSelectedDate, selectedCool, setSelectedCool } = useContext(AppContext);
    return (
        <div className={`w-full bg-gray-100 p-3 rounded-lg mt-4 grid grid-cols-1 sm:grid-cols-${hideCoolSelector ? '2' : '3'} gap-3`}>
            <div><label htmlFor="global-facility" className="block text-xs font-medium text-gray-600">施設</label><select id="global-facility" value={selectedFacility} onChange={(e) => setSelectedFacility(e.target.value)} className="w-full p-2 border border-gray-300 rounded-md transition text-sm">{FACILITIES.map(f => <option key={f} value={f}>{f}</option>)}</select></div>
            <div><label htmlFor="global-date" className="block text-xs font-medium text-gray-600">日付</label><input type="date" id="global-date" value={selectedDate} onChange={e => setSelectedDate(e.target.value)} className="w-full p-2 border border-gray-300 rounded-md transition text-sm" /></div>
            {!hideCoolSelector && (<div><label htmlFor="global-cool" className="block text-xs font-medium text-gray-600">クール</label><select id="global-cool" value={selectedCool} onChange={e => setSelectedCool(e.target.value)} className="w-full p-2 border border-gray-300 rounded-md transition text-sm"><option value="1">1</option><option value="2">2</option><option value="3">3</option></select></div>)}
        </div>
    );
};

const AppLayout = ({ children, navButtons, user, onGoBack, hideCoolSelector }) => (
    <div className="min-h-screen bg-gray-50 font-sans">
        <nav className="bg-white shadow-md p-3 sm:p-4 mb-8 sticky top-0 z-40 print:hidden">
            <div className="max-w-7xl mx-auto px-4"><div className="flex flex-wrap justify-between items-center"><div className="flex items-center">{onGoBack && (<button onClick={onGoBack} className="mr-4 flex items-center text-sm text-gray-600 hover:text-blue-600 transition"><svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg><span className="hidden sm:inline ml-1">戻る</span></button>)}<h1 className="text-lg sm:text-xl font-bold text-gray-800">患者呼び出しシステム</h1></div><div className="flex items-center space-x-1 sm:space-x-2 mt-2 sm:mt-0">{navButtons}</div></div><GlobalControls hideCoolSelector={hideCoolSelector} /></div>
        </nav>
        <main className="max-w-7xl mx-auto px-4 pb-8">{children}</main>
        <footer className="text-center text-sm text-gray-500 py-6 mt-8 border-t print:hidden"><p>ユーザーID: <span className="font-mono text-xs">{user?.uid}</span></p></footer>
    </div>
);

const StaffView = ({ user, onGoBack }) => {
    const [currentPage, setCurrentPage] = useState(isMobileDevice() ? 'staff' : 'admin');
    const hideCoolSelector = currentPage === 'monitor' || currentPage === 'staff';
    const NavButton = ({ page, label }) => (<button onClick={() => setCurrentPage(page)} className={`px-3 py-2 sm:px-4 rounded-lg font-medium transition duration-200 text-sm sm:text-base ${currentPage === page ? 'bg-blue-600 text-white shadow-md' : 'bg-white text-gray-700 hover:bg-gray-200'}`}>{label}</button>);
    const renderPage = () => { switch (currentPage) { case 'admin': return <AdminPage />; case 'staff': return <StaffPage />; case 'monitor': return <MonitorPage />; default: return <AdminPage />; } };
    return (<AppLayout user={user} onGoBack={onGoBack} hideCoolSelector={hideCoolSelector} navButtons={<><NavButton page="admin" label="管理" /><NavButton page="staff" label="スタッフ" /><NavButton page="monitor" label="モニター" /></>}>{renderPage()}</AppLayout>);
}

const PublicView = ({ user, onGoBack }) => (<AppLayout user={user} onGoBack={onGoBack} hideCoolSelector={true} navButtons={<span className="font-semibold text-gray-700">送迎担当者用</span>}><DriverPage /></AppLayout>);

const FacilitySelectionPage = ({ onSelectFacility, onGoBack, selectedRole}) => {
    const facilitiesToShow = selectedRole === 'public' ? FACILITIES.filter(f => f !== "入院透析室") : FACILITIES;
    return (
    <div className="flex items-center justify-center h-screen bg-gray-100"><div className="text-center p-8 bg-white rounded-xl shadow-lg max-w-md w-full"><h1 className="text-3xl font-bold text-gray-800 mb-4">施設を選択してください</h1><p className="text-gray-600 mb-8">表示する施設を選択してください。</p><div className="space-y-4">{facilitiesToShow.map(facility => (<button key={facility} onClick={() => onSelectFacility(facility)} className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-4 px-6 rounded-lg transition duration-300 text-lg">{facility}</button>))}</div><button onClick={onGoBack} className="mt-8 text-sm text-gray-600 hover:text-blue-600 transition">役割選択に戻る</button></div></div>
    )
};

const PasswordModal = ({ onSuccess, onCancel }) => {
    const [password, setPassword] = useState(''); const [error, setError] = useState(''); const CORRECT_PASSWORD = '2366';
    const handleSubmit = (e) => { e.preventDefault(); if (password === CORRECT_PASSWORD) onSuccess(); else setError('パスワードが違います。'); };
    return (<CustomModal title="スタッフ用パスワード認証" onClose={onCancel}><form onSubmit={handleSubmit}><p className="mb-4">スタッフ用のパスワードを入力してください。</p><input type="password" value={password} onChange={(e) => { setPassword(e.target.value); setError(''); }} className="w-full p-2 border rounded-md" autoFocus />{error && <p className="text-red-500 text-sm mt-2">{error}</p>}<div className="mt-6 flex justify-end"><button type="submit" className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-6 rounded-lg">認証</button></div></form></CustomModal>);
};

const RoleSelectionPage = ({ onSelectRole }) => {
    return (
        <div className="flex items-center justify-center h-screen bg-gray-100"><div className="text-center p-8 bg-white rounded-xl shadow-lg max-w-md w-full"><h1 className="text-3xl font-bold text-gray-800 mb-4">患者呼び出しシステム</h1><p className="text-gray-600 mb-8">利用する役割を選択してください</p><div className="space-y-4"><button onClick={() => onSelectRole('staff')} className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-4 px-6 rounded-lg transition duration-300 text-lg">スタッフ用</button><button onClick={() => onSelectRole('public')} className="w-full bg-green-600 hover:bg-green-700 text-white font-bold py-4 px-6 rounded-lg transition duration-300 text-lg">公開用 (送迎)</button></div></div></div>
    );
};

// --- App ---
export default function App() {
    const [user, setUser] = useState(null);
    const [authReady, setAuthReady] = useState(false);
    const [viewMode, setViewMode] = useState('login');
    const [selectedRole, setSelectedRole] = useState(null);
    const [selectedFacility, setSelectedFacility] = useState(FACILITIES[0]);
    const [selectedDate, setSelectedDate] = useState(getTodayString());
    const [selectedCool, setSelectedCool] = useState('1');

    useEffect(() => {
        const unlockAudio = () => {
            [globalSuccessAudio, globalErrorAudio].forEach(audio => { audio.muted = true; audio.play().catch(() => {}).then(() => { audio.pause(); audio.currentTime = 0; audio.muted = false; }); });
            document.removeEventListener('click', unlockAudio); document.removeEventListener('touchstart', unlockAudio);
        };
        document.addEventListener('click', unlockAudio); document.addEventListener('touchstart', unlockAudio);
        return () => { document.removeEventListener('click', unlockAudio); document.removeEventListener('touchstart', unlockAudio); };
    }, []);
    
    useEffect(() => {
        const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
            if (currentUser) { setUser(currentUser); } else { try { await signInAnonymously(auth); } catch (error) { console.error("Anonymous sign-in failed:", error); } }
            setAuthReady(true);
        });
        return () => unsubscribe();
    }, []);

    const handleRoleSelect = (role) => { setSelectedRole(role); if (role === 'staff') { setViewMode('password'); } else { setViewMode('facilitySelection'); } };
    const handlePasswordSuccess = () => { setViewMode('facilitySelection'); };
    const handleFacilitySelect = (facility) => { setSelectedFacility(facility); setViewMode(selectedRole); };
    const handleGoBack = () => { setViewMode('login'); setSelectedRole(null); };

    if (!authReady || !user) { return <div className="h-screen w-screen flex justify-center items-center bg-gray-100"><LoadingSpinner text="認証情報を確認中..." /></div>; }

    return (
        <DndProvider backend={HTML5Backend}>
            <AppContext.Provider value={{ selectedFacility, setSelectedFacility, selectedDate, setSelectedDate, selectedCool, setSelectedCool }}>
                {viewMode === 'login' && <RoleSelectionPage onSelectRole={handleRoleSelect} />}
                {viewMode === 'password' && <PasswordModal onSuccess={handlePasswordSuccess} onCancel={() => setViewMode('login')} />}
                {viewMode === 'facilitySelection' && <FacilitySelectionPage onSelectFacility={handleFacilitySelect} onGoBack={() => setViewMode('login')} selectedRole={selectedRole} />} 
                {viewMode === 'staff' && selectedFacility === "入院透析室" && (<InpatientView user={user} onGoBack={handleGoBack} />)}
                {viewMode === 'staff' && selectedFacility !== "入院透析室" && (<StaffView user={user} onGoBack={handleGoBack} />)}
                {viewMode === 'public' && <PublicView user={user} onGoBack={handleGoBack} />}
            </AppContext.Provider>
        </DndProvider>
    );
}