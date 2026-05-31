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
const DAY_MS = 86400000;

const uid = () => crypto.randomUUID();

function dateToMs(value) {
  if (!value) return null;
  const date = new Date(value + "T00:00:00");
  return Number.isNaN(date.getTime()) ? null : date.getTime();
}

function dateInterval(start, end) {
  const s = dateToMs(start);
  const e = dateToMs(end);
  if (s === null || e === null || e < s) return null;
  return { start: s, end: e };
}

function clampInterval(interval, bounds) {
  if (!interval) return null;
  if (!bounds) return interval;
  const clipped = {
    start: Math.max(interval.start, bounds.start),
    end: Math.min(interval.end, bounds.end),
  };
  return clipped.end >= clipped.start ? clipped : null;
}

function intervalDays(interval) {
  return Math.round((interval.end - interval.start) / DAY_MS) + 1;
}

function mergeIntervals(intervals) {
  const sorted = intervals
    .filter(Boolean)
    .sort((a, b) => a.start - b.start);
  const merged = [];

  sorted.forEach((interval) => {
    const last = merged[merged.length - 1];
    if (!last || interval.start > last.end + DAY_MS) {
      merged.push({ ...interval });
    } else {
      last.end = Math.max(last.end, interval.end);
    }
  });

  return merged;
}

function daysInIntervals(intervals) {
  return mergeIntervals(intervals).reduce((sum, interval) => sum + intervalDays(interval), 0);
}

function subtractIntervals(baseIntervals, removalIntervals) {
  const removals = mergeIntervals(removalIntervals);
  return mergeIntervals(baseIntervals).flatMap((base) => {
    let pieces = [base];

    removals.forEach((removal) => {
      pieces = pieces.flatMap((piece) => {
        if (removal.end < piece.start || removal.start > piece.end) return [piece];

        const next = [];
        if (removal.start > piece.start) {
          next.push({ start: piece.start, end: removal.start - DAY_MS });
        }
        if (removal.end < piece.end) {
          next.push({ start: removal.end + DAY_MS, end: piece.end });
        }
        return next;
      });
    });

    return pieces.filter((piece) => piece.end >= piece.start);
  });
}

function intersectIntervals(leftIntervals, rightIntervals) {
  const result = [];
  mergeIntervals(leftIntervals).forEach((left) => {
    mergeIntervals(rightIntervals).forEach((right) => {
      const interval = {
        start: Math.max(left.start, right.start),
        end: Math.min(left.end, right.end),
      };
      if (interval.end >= interval.start) result.push(interval);
    });
  });
  return mergeIntervals(result);
}

function personPresence(person, billPeriod) {
  const occupied = clampInterval(dateInterval(person.start, person.end), billPeriod);
  const occupiedIntervals = occupied ? [occupied] : [];
  const absenceIntervals = occupied
    ? (person.absences || [])
        .map((absence) => clampInterval(dateInterval(absence.start, absence.end), occupied))
        .filter(Boolean)
    : [];
  const presentIntervals = subtractIntervals(occupiedIntervals, absenceIntervals);
  const occupiedDays = daysInIntervals(occupiedIntervals);
  const days = daysInIntervals(presentIntervals);

  return {
    occupiedDays,
    absentDays: Math.max(0, occupiedDays - days),
    days,
    presentIntervals,
  };
}

function formatTitleDate(value) {
  const [year, month, day] = (value || "").split("-");
  return year && month && day ? `${year}/${month}/${day}` : "";
}

function titleFromDates(start, end) {
  if (start && end) return `${formatTitleDate(start)}-${formatTitleDate(end)}`;
  if (start) return `${formatTitleDate(start)}-?`;
  if (end) return `?-${formatTitleDate(end)}`;
  return "New monthly bill";
}

function currency(n) {
  return new Intl.NumberFormat("en-SG", {
    style: "currency",
    currency: "SGD",
    minimumFractionDigits: 2,
  }).format(Number.isFinite(n) ? n : 0);
}

const newAbsence = () => ({ id: uid(), start: "", end: "" });
const newPerson = (name = "New person", start = "", end = "") => ({
  id: uid(),
  name,
  start,
  end,
  absences: [],
});
const newPeriod = (start = "", end = "") => ({ id: uid(), start, end });

const newRoom = (name = "Room", start = "", end = "") => ({
  id: uid(),
  name,
  gasAdjustment: 0,
  electricityPeriods: [newPeriod(start, end)],
  people: [newPerson("Tenant", start, end)],
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
        { id: uid(), name: "我", start: "2026-04-05", end: "2026-04-29", absences: [] },
        { id: uid(), name: "朋友", start: "2026-04-22", end: "2026-04-30", absences: [] },
      ],
    },
    {
      id: uid(),
      name: "另一个房间",
      gasAdjustment: 0,
      electricityPeriods: [{ id: uid(), start: "2026-04-05", end: "2026-05-02" }],
      people: [{ id: uid(), name: "住户", start: "2026-04-05", end: "2026-05-02", absences: [] }],
    },
    {
      id: uid(),
      name: "肖姐房间",
      gasAdjustment: -3.56,
      electricityPeriods: [{ id: uid(), start: "2026-04-05", end: "2026-05-02" }],
      people: [
        { id: uid(), name: "肖姐", start: "2026-04-05", end: "2026-05-02", absences: [] },
        { id: uid(), name: "4/17-4/25 第二人", start: "2026-04-17", end: "2026-04-25", absences: [] },
      ],
    },
  ],
});

function normalizeBill(raw) {
  const startDate = raw.startDate || "";
  const endDate = raw.endDate || "";
  return {
    title: raw.title || titleFromDates(startDate, endDate),
    startDate,
    endDate,
    electricityTotal: raw.electricityTotal ?? "",
    waterTotal: raw.waterTotal ?? "",
    sharedOtherFee: raw.sharedOtherFee ?? 0,
    rooms: (raw.rooms || []).map((room) => ({
      id: room.id || uid(),
      name: room.name || "Room",
      gasAdjustment: room.gasAdjustment ?? 0,
      electricityPeriods: ((room.electricityPeriods || []).length
        ? room.electricityPeriods
        : [newPeriod(startDate, endDate)]
      ).map((period) => ({
        id: period.id || uid(),
        start: period.start || "",
        end: period.end || "",
      })),
      people: ((room.people || []).length ? room.people : [newPerson("Tenant", startDate, endDate)]).map(
        (person) => ({
          id: person.id || uid(),
          name: person.name || "New person",
          start: person.start || "",
          end: person.end || "",
          absences: (person.absences || []).map((absence) => ({
            id: absence.id || uid(),
            start: absence.start || "",
            end: absence.end || "",
          })),
        })
      ),
    })),
  };
}

function syncRoomsToBillPeriod(rooms, previousStart, previousEnd, nextStart, nextEnd) {
  return (rooms || []).map((room) => ({
    ...room,
    electricityPeriods: [
      {
        id: room.electricityPeriods?.[0]?.id || uid(),
        start: nextStart || "",
        end: nextEnd || "",
      },
    ],
    people: (room.people || []).map((person) => ({
      ...person,
      start: !person.start || person.start === previousStart ? nextStart || "" : person.start,
      end: !person.end || person.end === previousEnd ? nextEnd || "" : person.end,
      absences: person.absences || [],
    })),
  }));
}

function calculateBill(bill) {
  const rooms = bill.rooms || [];
  const billPeriod = dateInterval(bill.startDate, bill.endDate);

  const peopleRows = rooms.flatMap((room) =>
    (room.people || []).map((person) => {
      const presence = personPresence(person, billPeriod);
      return {
        ...person,
        roomId: room.id,
        ...presence,
      };
    })
  );

  const roomUseRows = rooms.map((room) => {
    const roomPeople = peopleRows.filter((p) => p.roomId === room.id);
    const occupiedRoomIntervals = mergeIntervals(roomPeople.flatMap((person) => person.presentIntervals));
    const electricityPeriodIntervals = mergeIntervals(
      (room.electricityPeriods || [])
        .map((period) => clampInterval(dateInterval(period.start, period.end), billPeriod))
        .filter(Boolean)
    );
    const electricityIntervals =
      electricityPeriodIntervals.length > 0
        ? intersectIntervals(occupiedRoomIntervals, electricityPeriodIntervals)
        : occupiedRoomIntervals;

    return {
      roomId: room.id,
      electricityDays: daysInIntervals(electricityIntervals),
    };
  });

  const totalRoomDays = roomUseRows.reduce((sum, row) => sum + row.electricityDays, 0);
  const electricityRate =
    totalRoomDays > 0 ? Number(bill.electricityTotal || 0) / totalRoomDays : 0;
  const totalPersonDays = peopleRows.reduce((sum, p) => sum + p.days, 0);
  const waterRate = totalPersonDays > 0 ? Number(bill.waterTotal || 0) / totalPersonDays : 0;
  const sharedFeePerRoom = rooms.length > 0 ? Number(bill.sharedOtherFee || 0) / rooms.length : 0;

  const roomResults = rooms.map((room) => {
    const roomUse = roomUseRows.find((row) => row.roomId === room.id);
    const roomPeople = peopleRows.filter((p) => p.roomId === room.id);
    const electricityDays = roomUse?.electricityDays || 0;
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
  const billTitle = titleFromDates(bill.startDate, bill.endDate);

  function updateBill(field, value) {
    setBill((prev) => ({ ...prev, [field]: value }));
  }

  function updateBillPeriod(field, value) {
    setBill((prev) => {
      const next = { ...prev, [field]: value };
      return {
        ...next,
        title: titleFromDates(next.startDate, next.endDate),
        rooms: syncRoomsToBillPeriod(
          prev.rooms,
          prev.startDate,
          prev.endDate,
          next.startDate,
          next.endDate
        ),
      };
    });
  }

  function loadBill(b) {
    setSelectedBillId(b.id);
    setBill(normalizeBill(b));
  }

  async function saveBill() {
    const data = {
      ...bill,
      title: billTitle,
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
    updateBill("rooms", [
      ...(bill.rooms || []),
      newRoom(`Room ${(bill.rooms || []).length + 1}`, bill.startDate, bill.endDate),
    ]);
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
        r.id === roomId
          ? { ...r, people: [...(r.people || []), newPerson("New person", bill.startDate, bill.endDate)] }
          : r
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

  function addAbsence(roomId, personId) {
    updateBill(
      "rooms",
      bill.rooms.map((r) =>
        r.id === roomId
          ? {
              ...r,
              people: r.people.map((p) =>
                p.id === personId ? { ...p, absences: [...(p.absences || []), newAbsence()] } : p
              ),
            }
          : r
      )
    );
  }

  function updateAbsence(roomId, personId, absenceId, field, value) {
    updateBill(
      "rooms",
      bill.rooms.map((r) =>
        r.id === roomId
          ? {
              ...r,
              people: r.people.map((p) =>
                p.id === personId
                  ? {
                      ...p,
                      absences: (p.absences || []).map((absence) =>
                        absence.id === absenceId ? { ...absence, [field]: value } : absence
                      ),
                    }
                  : p
              ),
            }
          : r
      )
    );
  }

  function removeAbsence(roomId, personId, absenceId) {
    updateBill(
      "rooms",
      bill.rooms.map((r) =>
        r.id === roomId
          ? {
              ...r,
              people: r.people.map((p) =>
                p.id === personId
                  ? { ...p, absences: (p.absences || []).filter((absence) => absence.id !== absenceId) }
                  : p
              ),
            }
          : r
      )
    );
  }

  function addElectricityPeriod(roomId) {
    updateBill(
      "rooms",
      bill.rooms.map((r) =>
        r.id === roomId
          ? { ...r, electricityPeriods: [...(r.electricityPeriods || []), newPeriod(bill.startDate, bill.endDate)] }
          : r
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
      `${billTitle}`,
      `Period: ${bill.startDate || "?"} to ${bill.endDate || "?"}`,
      `Electricity: ${currency(Number(bill.electricityTotal || 0))} / ${calculation.totalRoomDays} occupied room-days = ${currency(calculation.electricityRate)} per room-day`,
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
              <strong>{b.title || titleFromDates(b.startDate, b.endDate)}</strong>
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
                <label>Title<input className="readonly" value={billTitle} readOnly /></label>
                <label>Shared other fee, optional<input type="number" value={bill.sharedOtherFee ?? 0} onChange={(e) => updateBill("sharedOtherFee", e.target.value)} /></label>
                <label>Start date<input type="date" value={bill.startDate || ""} onChange={(e) => updateBillPeriod("startDate", e.target.value)} /></label>
                <label>End date<input type="date" value={bill.endDate || ""} onChange={(e) => updateBillPeriod("endDate", e.target.value)} /></label>
                <label>Total electricity<input type="number" value={bill.electricityTotal ?? ""} onChange={(e) => updateBill("electricityTotal", e.target.value)} /></label>
                <label>Total water<input type="number" value={bill.waterTotal ?? ""} onChange={(e) => updateBill("waterTotal", e.target.value)} /></label>
              </div>
            </div>
            <div className="card metric">
              <h2>Electricity</h2>
              <strong>{currency(calculation.electricityRate)}</strong>
              <span>per occupied room-day × {calculation.totalRoomDays}</span>
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
                      <div className="absence">
                        <div className="subhead compact">
                          <h3>Absent / travel dates</h3>
                          <button onClick={() => addAbsence(room.id, person.id)}><Plus size={14} /> Add</button>
                        </div>
                        {(person.absences || []).map((absence) => (
                          <div className="row3 absence-row" key={absence.id}>
                            <label>Away start<input type="date" value={absence.start || ""} onChange={(e) => updateAbsence(room.id, person.id, absence.id, "start", e.target.value)} /></label>
                            <label>Away end<input type="date" value={absence.end || ""} onChange={(e) => updateAbsence(room.id, person.id, absence.id, "end", e.target.value)} /></label>
                            <button className="icon bottom" onClick={() => removeAbsence(room.id, person.id, absence.id)}><Trash2 size={16} /></button>
                          </div>
                        ))}
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
                    <th>Room</th><th>Electricity days</th><th>Electricity</th><th>Water</th><th>Shared fee</th><th>Gas / adjustment</th><th>Total</th><th>Person-day detail</th>
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
                          <div key={p.id}>
                            {p.name || "Unnamed"}: {p.days} days
                            {p.absentDays > 0 ? ` (${p.occupiedDays} - ${p.absentDays} away)` : ""} → {currency(p.waterCost)}
                          </div>
                        ))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="note">
              Dates are counted inclusively. For example, 4/5–4/29 = 25 days.
              Electricity = total electricity ÷ occupied room-days. A room-day counts once if at least one person is present in that room after away dates are subtracted. Water = total water ÷ person-days after away dates are subtracted.
            </p>
          </section>
        </section>
      </main>
    </div>
  );
}
