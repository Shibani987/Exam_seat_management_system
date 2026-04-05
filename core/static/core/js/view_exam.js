// Fetch exam seating via get_exam_summary and render per-room grids
// This redraws the UI with Step 5 seat formatting, eligible/blocked/empty states.
document.addEventListener('DOMContentLoaded', function(){
    const examId = window.EXAM_ID || null;
    const container = document.getElementById('roomsContainer');
    const getSessionSortKey = (session) => {
        const normalized = String(session || '').trim().toLowerCase();
        if (['1st half', '1sthalf', 'first half', 'morning'].includes(normalized)) return 0;
        if (['2nd half', '2ndhalf', 'second half', 'afternoon'].includes(normalized)) return 1;
        return 2;
    };

    if (!examId) {
        container.innerHTML = '<p style="color:red;">Invalid exam ID</p>';
        return;
    }

    fetch(`/get_exam_summary/?exam_id=${examId}`)
        .then(r => r.json())
        .then(data => {
            if (data.status !== 'success') {
                container.innerHTML = `<p style="color:red;">Error: ${data.message || 'Failed to load seating'}</p>`;
                return;
            }

            const rooms = [];
            (data.rooms || []).forEach(room => {
                if (!room || !Array.isArray(room.seats) || room.seats.length === 0) {
                    rooms.push(room);
                    return;
                }

                const seatsBySlot = {};
                room.seats.forEach(seat => {
                    const slotKey = `${seat.exam_date || ''}||${seat.session || ''}`;
                    if (!seatsBySlot[slotKey]) {
                        seatsBySlot[slotKey] = [];
                    }
                    seatsBySlot[slotKey].push(seat);
                });

                const slotKeys = Object.keys(seatsBySlot).sort();
                if (slotKeys.length <= 1) {
                    rooms.push(room);
                    return;
                }

                slotKeys.forEach(slotKey => {
                    const [slotDate, slotSession] = slotKey.split('||');
                    rooms.push({
                        ...room,
                        slot_date: slotDate,
                        slot_session: slotSession,
                        department_details: Array.isArray(room.department_details)
                            ? room.department_details.filter(item =>
                                String(item.exam_date || '') === slotDate &&
                                String(item.session || '') === slotSession
                            )
                            : [],
                        seats: seatsBySlot[slotKey]
                    });
                });
            });

            rooms.sort((a, b) => {
                const aDate = String(a?.slot_date || a?.seats?.[0]?.exam_date || '');
                const bDate = String(b?.slot_date || b?.seats?.[0]?.exam_date || '');
                if (aDate !== bDate) return aDate.localeCompare(bDate);

                const aSession = getSessionSortKey(a?.slot_session || a?.seats?.[0]?.session || '');
                const bSession = getSessionSortKey(b?.slot_session || b?.seats?.[0]?.session || '');
                if (aSession !== bSession) return aSession - bSession;

                const aFilled = (a?.seats || []).filter(seat => seat.registration && seat.registration.trim() && seat.registration.trim().toUpperCase() !== 'EMPTY').length;
                const bFilled = (b?.seats || []).filter(seat => seat.registration && seat.registration.trim() && seat.registration.trim().toUpperCase() !== 'EMPTY').length;
                if (aFilled !== bFilled) return bFilled - aFilled;

                const aDeptCount = new Set((a?.department_details || []).map(item => String(item.department || '').trim().toUpperCase()).filter(Boolean)).size;
                const bDeptCount = new Set((b?.department_details || []).map(item => String(item.department || '').trim().toUpperCase()).filter(Boolean)).size;
                if (aDeptCount !== bDeptCount) return bDeptCount - aDeptCount;

                const aRoom = `${a?.building || ''}-${a?.room_number || ''}`;
                const bRoom = `${b?.building || ''}-${b?.room_number || ''}`;
                return aRoom.localeCompare(bRoom);
            });

            if (!rooms.length) {
                container.innerHTML = '<p style="color:#666;">No rooms with allocated seats available.</p>';
                return;
            }

            container.innerHTML = '';

            rooms.forEach(room => {
                const roomCard = document.createElement('div');
                roomCard.className = 'room-card';

                const roomStudents = (room.seats || []).filter(seat => seat.registration && seat.registration.trim() && seat.registration.trim().toUpperCase() !== 'EMPTY');
                const roomSemester = roomStudents.length > 0
                    ? String(roomStudents[0].semester || roomStudents[0].student_semester || '').trim()
                    : '';
                const roomDepartments = new Set();
                roomStudents.forEach(seat => {
                    if (seat.department && seat.department.trim()) {
                        roomDepartments.add(seat.department.trim().toUpperCase());
                    }
                });
                const semesterText = roomSemester || 'N/A';

                const header = document.createElement('div');
                header.className = 'room-header';
                header.innerHTML = `
                    <div>
                        <strong>${room.building} — ${room.room_number}</strong>
                        <div class="room-meta">${room.slot_date && room.slot_session ? `${room.slot_date} | ${room.slot_session} &nbsp; | &nbsp; ` : ''}Capacity: ${room.capacity} &nbsp; | &nbsp; Semester: ${semesterText}</div>
                    </div>
                `;
                const pdfBtn = document.createElement('button');
                pdfBtn.type = 'button';
                pdfBtn.textContent = 'Export A4 PDF';
                Object.assign(pdfBtn.style, {
                    marginLeft: '10px',
                    padding: '6px 10px',
                    borderRadius: '6px',
                    border: 'none',
                    background: '#1976d2',
                    color: '#fff',
                    cursor: 'pointer',
                    fontWeight: '600'
                });
                pdfBtn.addEventListener('click', () => openRoomPdfPrint(roomCard, room));
                header.appendChild(pdfBtn);
                roomCard.appendChild(header);

                const deptDiv = document.createElement('div');
                deptDiv.className = 'dept-info';
                deptDiv.innerHTML = renderDepartmentInfo(room, roomDepartments, roomSemester);
                roomCard.appendChild(deptDiv);

                const seatGrid = renderSeatGrid(room);
                roomCard.appendChild(seatGrid);

                container.appendChild(roomCard);
            });

            console.log('[VIEW_EXAM] Rendered', rooms.length, 'rooms');
        })
        .catch(err => {
            console.error('[VIEW_EXAM] Fetch error:', err);
            container.innerHTML = `<p style="color:red;">Error loading seating data: ${err.message || err}</p>`;
        });

    function renderDepartmentInfo(room, roomDepartments, roomSemester) {
        const roomStudents = (room.seats || []).filter(seat => seat.registration && seat.registration.trim() && seat.registration.trim().toUpperCase() !== 'EMPTY');

        const firstSeat = roomStudents.length > 0 ? roomStudents[0] : null;
        const targetDate = firstSeat ? firstSeat.exam_date : '';
        const targetSession = firstSeat ? firstSeat.session : '';

        let filteredDetails = (room.department_details || []).filter(item => {
            const dept = (item.department || '').trim().toUpperCase();
            if (!dept || !roomDepartments.has(dept)) return false;
            if (roomSemester && item.semester && item.semester.toString().trim() !== roomSemester) return false;
            if (targetDate && item.exam_date !== targetDate) return false;
            if (targetSession && item.session !== targetSession) return false;
            return true;
        });

        filteredDetails = filteredDetails.map(item => {
            if (item.start_time && item.end_time && item.start_time !== 'N/A' && item.end_time !== 'N/A') {
                return item;
            }

            const fallback = (room.department_details || []).find(candidate => {
                return String(candidate.department || '').trim().toUpperCase() === String(item.department || '').trim().toUpperCase()
                    && String(candidate.exam_name || '').trim() === String(item.exam_name || '').trim()
                    && String(candidate.exam_date || '').trim() === String(item.exam_date || '').trim()
                    && String(candidate.session || '').trim() === String(item.session || '').trim()
                    && candidate.start_time
                    && candidate.end_time
                    && candidate.start_time !== 'N/A'
                    && candidate.end_time !== 'N/A';
            });

            return fallback ? { ...item, start_time: fallback.start_time, end_time: fallback.end_time } : item;
        });

        let html = '<strong>Departments in this room:</strong><br>';
        if (roomSemester) {
            html += `Students in this room are from Semester ${roomSemester}<br><br>`;
        }

        if (filteredDetails.length > 0) {
            const groupedBySlot = {};
            filteredDetails.forEach(item => {
                const key = `${item.exam_date}||${item.session}`;
                if (!groupedBySlot[key]) {
                    groupedBySlot[key] = { date: item.exam_date, session: item.session, rows: [] };
                }
                groupedBySlot[key].rows.push(item);
            });

            Object.values(groupedBySlot).forEach(slot => {
                html += `<strong>${slot.date}, ${slot.session}:</strong><br>`;
                slot.rows.forEach(item => {
                    const semText = item.semester ? ` [Sem ${item.semester}]` : '';
                    html += `&nbsp;&nbsp;${item.department}${semText} - ${item.exam_name}<br>`;
                    html += `&nbsp;&nbsp;&nbsp;&nbsp;Timing: ${item.start_time || 'N/A'} - ${item.end_time || 'N/A'}<br>`;
                });
                html += '<br>';
            });
        } else {
            html += '<span style="color:#666;">No scheduled exam details for this room / slot.</span>';
        }

        return html;
    }

    function renderSeatGrid(room) {
        const capacity = parseInt(room.capacity, 10) || 0;
        const rowsNeeded = capacity > 0 ? Math.ceil(capacity / 5) : 0;
        const rows = [];
        for (let i = 0; i < rowsNeeded; i++) rows.push(String.fromCharCode(65 + i));

        const grid = document.createElement('div');
        grid.className = 'seat-grid';

        if (rows.length === 0) {
            grid.innerHTML = '<div style="color:#666; padding:10px;">No seats defined in this room</div>';
            return grid;
        }

        rows.forEach((row, rowIdx) => {
            const rowDiv = document.createElement('div');
            rowDiv.className = 'seat-row';

            let colsToRender = [1, 2, 3, 4, 5];
            if (rowIdx === rows.length - 1) {
                const filledBefore = (rows.length - 1) * 5;
                const lastRowCols = Math.max(0, capacity - filledBefore);
                colsToRender = colsToRender.slice(0, lastRowCols);
            }

            colsToRender.forEach(col => {
                const seatDiv = document.createElement('div');
                seatDiv.className = 'seat';

                const seat = (room.seats || []).find(s => s.row === row && Number(s.column) === col);

                if (seat && seat.registration && seat.registration !== 'Empty') {
                    const isEligible = seat.is_eligible === true || String(seat.is_eligible).toLowerCase() === 'true';

                    if (isEligible) {
                        seatDiv.classList.add('eligible');
                        seatDiv.classList.remove('blocked', 'empty');
                        const reg = seat.registration || '';
                        const dept = (seat.department || '').trim();
                        seatDiv.innerHTML = `
                            <div class="seat-num">${row}${col}</div>
                            <div class="seat-info">${dept} ${reg}</div>
                        `;
                    } else {
                        seatDiv.classList.remove('eligible', 'empty');
                        seatDiv.classList.add('blocked');
                        seatDiv.innerHTML = `
                            <div class="seat-num">${row}${col}</div>
                        `;
                    }

                } else {
                    seatDiv.classList.remove('eligible', 'blocked');
                    seatDiv.classList.add('empty');
                    seatDiv.innerHTML = `
                        <div class="seat-num">${row}${col}</div>
                        <div class="seat-info">EMPTY</div>
                    `;
                }

                rowDiv.appendChild(seatDiv);
            });

            grid.appendChild(rowDiv);
        });

        return grid;
    }

    function buildRoomPdfFilename(room) {
        const parts = [
            room.building || 'room',
            room.room_number || 'na',
            room.slot_date || room.seats?.[0]?.exam_date || '',
            room.slot_session || room.seats?.[0]?.session || ''
        ];
        return parts.filter(Boolean).join('-').replace(/[^\w.-]+/g, '_');
    }

    function openRoomPdfPrint(roomCard, room) {
        const printWindow = window.open('', '_blank', 'width=1100,height=900');
        if (!printWindow) {
            alert('Popup blocked. Please allow popups to export PDF.');
            return;
        }

        const printableRoom = roomCard.cloneNode(true);
        printableRoom.querySelectorAll('button').forEach(btn => btn.remove());
        const safeTitle = buildRoomPdfFilename(room);

        printWindow.document.write(`
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="UTF-8">
                <title>${safeTitle}</title>
                <style>
                    @page { size: A4 portrait; margin: 8mm; }
                    * { box-sizing: border-box; }
                    body { margin: 0; font-family: Arial, sans-serif; color: #000; background: #fff; }
                    .print-page { width: 194mm; min-height: 281mm; margin: 0 auto; }
                    .room-card {
                        width: 100%;
                        border: 1px solid #d0d0d0;
                        border-radius: 8px;
                        padding: 10px;
                        background: #fff;
                    }
                    .room-header {
                        display: flex;
                        justify-content: space-between;
                        align-items: flex-start;
                        gap: 10px;
                        margin-bottom: 8px;
                        padding-bottom: 8px;
                        border-bottom: 1px solid #ddd;
                        font-size: 12px;
                    }
                    .dept-info {
                        margin-bottom: 8px;
                        padding: 8px;
                        background: #fff;
                        border-left: 3px solid #1976d2;
                        border-radius: 4px;
                        font-size: 11px;
                        line-height: 1.3;
                    }
                    .seat-grid {
                        display: flex;
                        flex-direction: column;
                        gap: 6px;
                        background: #f9f9f9;
                        padding: 10px;
                        border-radius: 8px;
                        width: 100%;
                        border: 1px solid #e0e0e0;
                    }
                    .seat-row {
                        display: grid;
                        grid-template-columns: repeat(5, 1fr);
                        gap: 6px;
                        width: 100%;
                    }
                    .seat {
                        aspect-ratio: 1;
                        min-width: 0;
                        min-height: 0;
                        border-radius: 6px;
                        display: flex;
                        flex-direction: column;
                        align-items: center;
                        justify-content: center;
                        font-size: 8px;
                        text-align: center;
                        font-weight: 600;
                        padding: 4px;
                        background: #fff;
                        border: 1px solid #ccc;
                        overflow: hidden;
                        page-break-inside: avoid;
                    }
                    .seat.eligible { background: #28a745 !important; color: #fff !important; border-color: #228b22 !important; }
                    .seat.blocked { background: #ffffff !important; color: #000 !important; }
                    .seat.empty { background: #f1f1f1 !important; color: #666 !important; }
                    .seat-num { font-weight: 700; font-size: 8px; margin-bottom: 2px; }
                    .seat-info { font-size: 7px; line-height: 1.1; width: 100%; word-break: break-word; }
                </style>
            </head>
            <body>
                <div class="print-page">${printableRoom.outerHTML}</div>
                <script>
                    window.onload = function() {
                        setTimeout(function() {
                            window.print();
                        }, 250);
                    };
                <\/script>
            </body>
            </html>
        `);
        printWindow.document.close();
    }
});
