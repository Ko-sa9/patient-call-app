import { useContext, useState, useEffect } from 'react';
import { collection, onSnapshot, query, doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { AppContext } from '../context/AppContext';
import { db } from '../firebase'; // Firebaseの初期化ファイルを別途作成することを推奨

export const useDailyList = () => {
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

export const useAllDayPatients = () => {
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

export const updatePatientStatus = async (facility, date, cool, patientId, newStatus) => {
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
