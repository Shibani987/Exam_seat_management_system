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
                const roomSemesters = new Set();
                const roomDepartments = new Set();
                (room.department_details || []).forEach(item => {
                    if (item.semester && item.semester.toString().trim()) {
                        roomSemesters.add(item.semester.toString().trim());
                    }
                });
                roomStudents.forEach(seat => {
                    const seatSemester = seat.semester || seat.student_semester || '';
                    if (seatSemester && seatSemester.toString().trim()) {
                        roomSemesters.add(seatSemester.toString().trim());
                    }
                    if (seat.department && seat.department.trim()) {
                        roomDepartments.add(seat.department.trim().toUpperCase());
                    }
                });
                const semesterText = roomSemesters.size ? Array.from(roomSemesters).sort().join(', ') : 'N/A';

                const header = document.createElement('div');
                header.className = 'room-header';
                header.innerHTML = `
                    <div>
                        <strong>${room.building} — ${room.room_number}</strong>
                        <div class="room-meta">${room.slot_date && room.slot_session ? `${room.slot_date} | ${room.slot_session} &nbsp; | &nbsp; ` : ''}Capacity: ${room.capacity} &nbsp; | &nbsp; Semester: ${semesterText}</div>
                    </div>
                `;
                roomCard.appendChild(header);

                const deptDiv = document.createElement('div');
                deptDiv.className = 'dept-info';
                deptDiv.innerHTML = renderDepartmentInfo(room, roomDepartments, roomSemesters);
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

    function renderDepartmentInfo(room, roomDepartments, roomSemesters) {
        const roomStudents = (room.seats || []).filter(seat => seat.registration && seat.registration.trim() && seat.registration.trim().toUpperCase() !== 'EMPTY');

        const firstSeat = roomStudents.length > 0 ? roomStudents[0] : null;
        const targetDate = firstSeat ? firstSeat.exam_date : '';
        const targetSession = firstSeat ? firstSeat.session : '';

        let filteredDetails = (room.department_details || []).filter(item => {
            const dept = (item.department || '').trim().toUpperCase();
            if (!dept || !roomDepartments.has(dept)) return false;
            if (item.semester && !roomSemesters.has(item.semester.toString().trim())) return false;
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

        const deptLine = roomDepartments.size ? Array.from(roomDepartments).join(', ') : 'N/A';
        const semLine = roomSemesters.size ? Array.from(roomSemesters).join(', ') : 'N/A';

        let html = `<strong>Departments in this room:</strong> ${deptLine}<br>`;
        html += `<strong>Semesters in this room:</strong> ${semLine}<br><br>`;

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
                        const sem = seat.semester || seat.student_semester || '';
                        const semText = sem ? ` (Sem ${sem})` : '';
                        seatDiv.innerHTML = `
                            <div class="seat-num">${row}${col}</div>
                            <div class="seat-info">${dept} ${reg}${semText}</div>
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
});
