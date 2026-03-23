// Fetch exam seating via get_exam_summary and render per-room grids
// This redraws the UI with Step 5 seat formatting, eligible/blocked/empty states.
document.addEventListener('DOMContentLoaded', function(){
    const examId = window.EXAM_ID || null;
    const container = document.getElementById('roomsContainer');

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

            const rooms = data.rooms || [];

            if (!rooms.length) {
                container.innerHTML = '<p style="color:#666;">No rooms with allocated seats available.</p>';
                return;
            }

            container.innerHTML = '';

            rooms.forEach(room => {
                const roomCard = document.createElement('div');
                roomCard.className = 'room-card';

                // Calculate semesters and departments from actual seated students
                const roomStudents = (room.seats || []).filter(seat => seat.registration && seat.registration.trim() && seat.registration.trim().toUpperCase() !== 'EMPTY');
                const roomSemesters = new Set();
                const roomDepartments = new Set();
                roomStudents.forEach(seat => {
                    if (seat.semester && seat.semester.toString().trim()) {
                        roomSemesters.add(seat.semester.toString().trim());
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
                        <div class="room-meta">Capacity: ${room.capacity} &nbsp; | &nbsp; Semester: ${semesterText}</div>
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
                        const sem = seat.semester || seat.sem || '';
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
