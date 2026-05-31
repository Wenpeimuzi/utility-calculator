import React, { useEffect, useMemo, useState } from "react";
import { initializeApp } from "firebase/app";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getFirestore,
  onSnapshot,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";
import { Copy, History, Plus, Save, Trash2 } from "lucide-react";

const firebaseConfig = {
  apiKey: "AIzaSyBN2PT5M_9Q8aSj439YXtmI8OzrDYOiXpI",
  authDomain: "utility-calculator-d4441.firebaseapp.com",
  projectId: "utility-calculator-d4441",
  storageBucket: "utility-calculator-d4441.firebasestorage.app",
  messagingSenderId: "319204767560",
  appId: "1:319204767560:web:ac13469424f28418eb257d",
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const HOUSEHOLD_ID = "wenpei-flat";

const uid = () => crypto.randomUUID();

function daysBetweenInclusive(start, end) {
  if (!start || !end) return 0;
  const s = new Date(start + "T00:00:00");
  const e = new Date(end + "T00:00:00");
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime()) || e < s) return 0;
  return Math.round((e - s) / 86400000) + 1;
}

function currency(n) {
  return new Intl.NumberFormat("en-SG", {
    style: "currency",
    currency: "SGD",
    minimumFractionDigits: 2,
  }).format(Number.isFinite(n) ? n : 0);
}

const newPerson = (name = "New person") => ({ id: uid(), name, start: "", end: "" });
const newPeriod = () => ({ id: uid(), start: "", end: "" });

const newRoom = (name = "Room") => ({
  id: uid(),
  name,
  gasAdjustment: 0,
  electricityPeriods: [newPeriod()],
  people: [newPerson("Tenant")],
});

const emptyBill = () => ({
  title: "New monthly bill",
  startDate: "",
  endDate: "",
  electricityTotal: "",
  waterTotal: "",
  sharedOtherFee: 0,
  rooms: [newRoom("Room A"), newRoom("Room B"), newRoom("Room C")],
});

const exampleBill = () => ({
  title: "2026/04/05–2026/05/02",
  startDate: "2026-04-05",
  endDate: "2026-05-02",
  electricityTotal: 159.41,
  waterTotal: 25.4,
  sharedOtherFee: 0,
  rooms: [
    {
      id: uid(),
      name: "我的房间",
      gasAdjustment: 0,
      electricityPeriods: [{ id: uid(), start: "2026-04-05", end: "2026-04-30" }],
      people: [
        { id: uid(), name: "我", start: "2026-04-05", end: "2026-04-29" },
        { id: uid(), name: "朋友", start: "2026-04-22", end: "2026-04-30" },
      ],
    },
    {
      id: uid(),
      name: "另一个房间",
      gasAdjustment: 0,
      electricityPeriods: [{ id: uid(), start: "2026-04-05", end: "2026-05-02" }],
      people: [{ id: uid(), name: "住户", start: "2026-04-05", end: "2026-05-02" }],
    },
    {
      id: uid(),
      name: "肖姐房间",
      gasAdjustment: -3.56,
      electricityPeriods: [{ id: uid(), start: "2026-04-05", end: "2026-05-02" }],
      people: [
        { id: uid(), name: "肖姐", start: "2026-04-05", end: "2026-05-02" },
        { id: uid(), name: "4/17-4/25 第二人", start: "2026-04-17", end: "2026-04-25" },
      ],
    },
  ],
});

function calculateBill(bill) {
  const rooms = bill.rooms || [];
  const roomPeriodRows = rooms.flatMap((room) =>
    (room.electricityPeriods || []).map((period) => ({
      ...period,
      roomId: room.id,
      days: daysBetweenInclusive(period.start, period.end),
    }))
  );
  const totalRoomDays = roomPeriodRows.reduce((sum, r) => sum + r.days, 0);
  const electricityRate =
    totalRoomDays > 0 ? Number(bill.electricityTotal || 0) / totalRoomDays : 0;

  const peopleRows = rooms.flatMap((room) =>
    (room.people || []).map((person) => ({
      ...person,
      roomId: room.id,
      days: daysBetweenInclusive(person.start, person.end),
    }))
  );
  const totalPersonDays = peopleRows.reduce((sum, p) => sum + p.days, 0);
  const waterRate = totalPersonDays > 0 ? Number(bill.waterTotal || 0) / totalPersonDays : 0;
  const sharedFeePerRoom = rooms.length > 0 ? Number(bill.sharedOtherFee || 0) / rooms.length : 0;

  const roomResults = rooms.map((room) => {
    const roomPeriods = roomPeriodRows.filter((r) => r.roomId === room.id);
    const roomPeople = peopleRows.filter((p) => p.roomId === room.id);
    const electricityDays = roomPeriods.reduce((sum, r) => sum + r.days, 0);
    const electricity = electricityDays * electricityRate;
    const water = roomPeople.reduce((sum, p) => sum + p.days * waterRate, 0);
    const gasAdjustment = Number(room.gasAdjustment || 0);
    const total = electricity + water + sharedFeePerRoom + gasAdjustment;
    return {
      ...room,
      electricityDays,
      electricity,
      water,
      sharedFee: sharedFeePerRoom,
      gasAdjustment,
      total,
      people: roomPeople.map((p) => ({ ...p, waterCost: p.days * waterRate })),
    };
  });

  return { totalRoomDays, electricityRate, totalPersonDays, waterRate, roomResults };
}

export default function App() {
  const [bills, setBills] = useState([]);
  const [selectedBillId, setSelectedBillId] = useState(null);
  const [bill, setBill] = useState(exampleBill());
  const [status, setStatus] = useState("Not saved yet");

  useEffect(() => {
    const billsRef = collection(db, "households", HOUSEHOLD_ID, "bills");
    return onSnapshot(
      billsRef,
      (snapshot) => {
        const rows = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
        rows.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
        setBills(rows);
        if (!selectedBillId && rows.length > 0) {
          loadBill(rows[0]);
          setStatus("Loaded from Firebase");
        }
      },
      (error) => setStatus(`Firebase error: ${error.message}`)
    );
  }, [selectedBillId]);

  const calculation = useMemo(() => calculateBill(bill), [bill]);

  function updateBill(field, value) {
    setBill((prev) => ({ ...prev, [field]: value }));
  }

  function loadBill(b) {
    setSelectedBillId(b.id);
    setBill({
      title: b.title || "Monthly bill",
      startDate: b.startDate || "",
      endDate: b.endDate || "",
      electricityTotal: b.electricityTotal ?? "",
      waterTotal: b.waterTotal ?? "",
      sharedOtherFee: b.sharedOtherFee ?? 0,
      rooms: b.rooms || [],
    });
  }

  async function saveBill() {
    const data = {
      ...bill,
      electricityTotal: Number(bill.electricityTotal || 0),
      waterTotal: Number(bill.waterTotal || 0),
      sharedOtherFee: Number(bill.sharedOtherFee || 0),
      updatedAt: serverTimestamp(),
    };

    if (selectedBillId) {
      await setDoc(doc(db, "households", HOUSEHOLD_ID, "bills", selectedBillId), data, { merge: true });
      setStatus("Saved to Firebase");
    } else {
      const added = await addDoc(collection(db, "households", HOUSEHOLD_ID, "bills"), {
        ...data,
        createdAt: serverTimestamp(),
      });
      setSelectedBillId(added.id);
      setStatus("Saved as a new month");
    }
  }

  async function deleteCurrentBill() {
    if (!selectedBillId) return;
    await deleteDoc(doc(db, "households", HOUSEHOLD_ID, "bills", selectedBillId));
    setSelectedBillId(null);
    setBill(emptyBill());
    setStatus("Deleted current bill");
  }

  function addRoom() {
    updateBill("rooms", [...(bill.rooms || []), newRoom(`Room ${(bill.rooms || []).length + 1}`)]);
  }

  function updateRoom(roomId, field, value) {
    updateBill(
      "rooms",
      bill.rooms.map((r) => (r.id === roomId ? { ...r, [field]: value } : r))
    );
  }

  function removeRoom(roomId) {
    updateBill("rooms", bill.rooms.filter((r) => r.id !== roomId));
  }

  function addPerson(roomId) {
    updateBill(
      "rooms",
      bill.rooms.map((r) =>
        r.id === roomId ? { ...r, people: [...(r.people || []), newPerson()] } : r
      )
    );
  }

  function updatePerson(roomId, personId, field, value) {
    updateBill(
      "rooms",
      bill.rooms.map((r) =>
        r.id === roomId
          ? { ...r, people: r.people.map((p) => (p.id === personId ? { ...p, [field]: value } : p)) }
          : r
      )
    );
  }

  function removePerson(roomId, personId) {
    updateBill(
      "rooms",
      bill.rooms.map((r) =>
        r.id === roomId ? { ...r, people: r.people.filter((p) => p.id !== personId) } : r
      )
    );
  }

  function addElectricityPeriod(roomId) {
    updateBill(
      "rooms",
      bill.rooms.map((r) =>
        r.id === roomId ? { ...r, electricityPeriods: [...(r.electricityPeriods || []), newPeriod()] } : r
      )
    );
  }

  function updateElectricityPeriod(roomId, periodId, field, value) {
    updateBill(
      "rooms",
      bill.rooms.map((r) =>
        r.id === roomId
          ? {
              ...r,
              electricityPeriods: r.electricityPeriods.map((p) =>
                p.id === periodId ? { ...p, [field]: value } : p
              ),
            }
          : r
      )
    );
  }

  function removeElectricityPeriod(roomId, periodId) {
    updateBill(
      "rooms",
      bill.rooms.map((r) =>
        r.id === roomId
          ? { ...r, electricityPeriods: r.electricityPeriods.filter((p) => p.id !== periodId) }
          : r
      )
    );
  }

  async function copyResult() {
    const lines = [
      `${bill.title}`,
      `Period: ${bill.startDate || "?"} to ${bill.endDate || "?"}`,
      `Electricity: ${currency(Number(bill.electricityTotal || 0))} / ${calculation.totalRoomDays} room-days = ${currency(calculation.electricityRate)} per room-day`,
      `Water: ${currency(Number(bill.waterTotal || 0))} / ${calculation.totalPersonDays} person-days = ${currency(calculation.waterRate)} per person-day`,
      "",
      ...calculation.roomResults.map(
        (r) =>
          `${r.name}: ${currency(r.total)}  electricity ${currency(r.electricity)} + water ${currency(r.water)} + gas/adjustment ${currency(r.gasAdjustment)}`
      ),
    ];
    await navigator.clipboard.writeText(lines.join("\n"));
    setStatus("Result copied");
  }

  return (
    <div className="page">
      <header className="top">
        <div>
          <h1>Shared Utility Calculator</h1>
          <p>大家打开同一个网页，就能看到同一份每月水电费记录。修改后请点击 Save。</p>
          <p className="status">Status: {status}</p>
        </div>
        <div className="actions">
          <button onClick={() => { setSelectedBillId(null); setBill(emptyBill()); }}>New month</button>
          <button onClick={() => { setSelectedBillId(null); setBill(exampleBill()); }}>Load example</button>
          <button className="primary" onClick={saveBill}><Save size={16} /> Save</button>
          <button onClick={copyResult}><Copy size={16} /> Copy result</button>
        </div>
      </header>

      <main className="layout">
        <aside className="card sidebar">
          <h2><History size={18} /> Monthly history</h2>
          {bills.length === 0 && <p className="muted">No saved months yet.</p>}
          {bills.map((b) => (
            <button
              key={b.id}
              className={selectedBillId === b.id ? "month selected" : "month"}
              onClick={() => loadBill(b)}
            >
              <strong>{b.title || "Monthly bill"}</strong>
              <span>{b.startDate || "?"} to {b.endDate || "?"}</span>
            </button>
          ))}
          <button className="danger wide" disabled={!selectedBillId} onClick={deleteCurrentBill}>
            <Trash2 size={16} /> Delete selected
          </button>
        </aside>

        <section className="content">
          <section className="grid summary">
            <div className="card span2">
              <h2>Monthly bill</h2>
              <div className="formgrid">
                <label>Title<input value={bill.title || ""} onChange={(e) => updateBill("title", e.target.value)} /></label>
                <label>Shared other fee, optional<input type="number" value={bill.sharedOtherFee ?? 0} onChange={(e) => updateBill("sharedOtherFee", e.target.value)} /></label>
                <label>Start date<input type="date" value={bill.startDate || ""} onChange={(e) => updateBill("startDate", e.target.value)} /></label>
                <label>End date<input type="date" value={bill.endDate || ""} onChange={(e) => updateBill("endDate", e.target.value)} /></label>
                <label>Total electricity<input type="number" value={bill.electricityTotal ?? ""} onChange={(e) => updateBill("electricityTotal", e.target.value)} /></label>
                <label>Total water<input type="number" value={bill.waterTotal ?? ""} onChange={(e) => updateBill("waterTotal", e.target.value)} /></label>
              </div>
            </div>
            <div className="card metric">
              <h2>Electricity</h2>
              <strong>{currency(calculation.electricityRate)}</strong>
              <span>per room-day × {calculation.totalRoomDays}</span>
            </div>
            <div className="card metric">
              <h2>Water</h2>
              <strong>{currency(calculation.waterRate)}</strong>
              <span>per person-day × {calculation.totalPersonDays}</span>
            </div>
          </section>

          <section className="rooms">
            {(bill.rooms || []).map((room) => (
              <div className="card room" key={room.id}>
                <div className="roomhead">
                  <input className="roomname" value={room.name} onChange={(e) => updateRoom(room.id, "name", e.target.value)} />
                  <button className="icon" onClick={() => removeRoom(room.id)}><Trash2 size={16} /></button>
                </div>

                <label>Room-specific gas / adjustment
                  <input type="number" value={room.gasAdjustment ?? 0} onChange={(e) => updateRoom(room.id, "gasAdjustment", e.target.value)} />
                </label>

                <div className="subcard">
                  <div className="subhead">
                    <h3>Electricity room-use periods</h3>
                    <button onClick={() => addElectricityPeriod(room.id)}><Plus size={14} /> Add</button>
                  </div>
                  {(room.electricityPeriods || []).map((period) => (
                    <div className="row3" key={period.id}>
                      <label>Start<input type="date" value={period.start || ""} onChange={(e) => updateElectricityPeriod(room.id, period.id, "start", e.target.value)} /></label>
                      <label>End<input type="date" value={period.end || ""} onChange={(e) => updateElectricityPeriod(room.id, period.id, "end", e.target.value)} /></label>
                      <button className="icon bottom" onClick={() => removeElectricityPeriod(room.id, period.id)}><Trash2 size={16} /></button>
                    </div>
                  ))}
                </div>

                <div className="subcard">
                  <div className="subhead">
                    <h3>Water people / guest periods</h3>
                    <button onClick={() => addPerson(room.id)}><Plus size={14} /> Add</button>
                  </div>
                  {(room.people || []).map((person) => (
                    <div className="person" key={person.id}>
                      <label>Name<input value={person.name || ""} onChange={(e) => updatePerson(room.id, person.id, "name", e.target.value)} /></label>
                      <div className="row3">
                        <label>Start<input type="date" value={person.start || ""} onChange={(e) => updatePerson(room.id, person.id, "start", e.target.value)} /></label>
                        <label>End<input type="date" value={person.end || ""} onChange={(e) => updatePerson(room.id, person.id, "end", e.target.value)} /></label>
                        <button className="icon bottom" onClick={() => removePerson(room.id, person.id)}><Trash2 size={16} /></button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </section>

          <button className="primary addroom" onClick={addRoom}><Plus size={16} /> Add room</button>

          <section className="card">
            <h2>Results by room</h2>
            <div className="tablewrap">
              <table>
                <thead>
                  <tr>
                    <th>Room</th><th>Electricity days</th><th>Electricity</th><th>Water</th><th>Shared fee</th><th>Gas / adjustment</th><th>Total</th><th>Water detail</th>
                  </tr>
                </thead>
                <tbody>
                  {calculation.roomResults.map((room) => (
                    <tr key={room.id}>
                      <td><strong>{room.name}</strong></td>
                      <td>{room.electricityDays}</td>
                      <td>{currency(room.electricity)}</td>
                      <td>{currency(room.water)}</td>
                      <td>{currency(room.sharedFee)}</td>
                      <td>{currency(room.gasAdjustment)}</td>
                      <td><strong>{currency(room.total)}</strong></td>
                      <td>
                        {room.people.map((p) => (
                          <div key={p.id}>{p.name || "Unnamed"}: {p.days} days → {currency(p.waterCost)}</div>
                        ))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="note">
              Dates are counted inclusively. For example, 4/5–4/29 = 25 days.
              Electricity = total electricity ÷ room-use days. Water = total water ÷ person-days.
            </p>
          </section>
        </section>
      </main>
    </div>
  );
}
