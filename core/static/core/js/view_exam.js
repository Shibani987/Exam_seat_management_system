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

                const semesters = new Set((room.department_details || []).map(d => d.semester).filter(s => s));
                const semesterText = semesters.size ? Array.from(semesters).join(', ') : 'N/A';

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
                deptDiv.innerHTML = renderDepartmentInfo(room);
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

    function renderDepartmentInfo(room) {
        const seatDepartments = new Set();
        const seatSemesters = new Set();

        (room.seats || []).forEach(seat => {
            if (seat.department && seat.department.trim() && seat.department.toUpperCase() !== 'EMPTY') {
                seatDepartments.add(seat.department.trim());
            }
            if (seat.semester && seat.semester.trim()) {
                seatSemesters.add(seat.semester.trim());
            }
        });

        if (!room.department_details || !room.department_details.length) {
            const deptLine = seatDepartments.size ? Array.from(seatDepartments).join(', ') : 'N/A';
            const semLine = seatSemesters.size ? Array.from(seatSemesters).join(', ') : 'N/A';
            return `<strong>Departments in this room:</strong><br/>${deptLine}<br/><strong>Semesters in this room:</strong> ${semLine}`;
        }

        let html = `<strong>Departments in this room:</strong><br/>${Array.from(seatDepartments).join(', ') || 'N/A'}<br/>`;
        html += `<strong>Semesters in this room:</strong> ${Array.from(seatSemesters).join(', ') || 'N/A'}<br/><br/>`;

        const groupedBySlot = {};
        (room.department_details || []).forEach(item => {
            const key = `${item.exam_date}||${item.session}`;
            if (!groupedBySlot[key]) {
                groupedBySlot[key] = { date: item.exam_date, session: item.session, rows: [] };
            }
            groupedBySlot[key].rows.push(item);
        });

        Object.values(groupedBySlot).forEach(slot => {
            html += `<strong>${slot.date}, ${slot.session}:</strong><br/>`;
            slot.rows.forEach(item => {
                const semText = item.semester ? ` [Sem ${item.semester}]` : '';
                html += `&nbsp;&nbsp;${item.department}${semText} - ${item.exam_name}<br/>`;
                html += `&nbsp;&nbsp;&nbsp;&nbsp;Timing: ${item.start_time || 'N/A'} - ${item.end_time || 'N/A'}<br/>`;
            });
            html += '<br/>';
        });

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
                    const semDisplay = seat.semester ? `Sem ${seat.semester}` : (seat.sem ? `Sem ${seat.sem}` : 'Sem N/A');
                    const studentText = `${seat.department || 'Unknown'} ${seat.registration || 'Unknown'} (${semDisplay})`;

                    if (isEligible) {
                        seatDiv.classList.add('eligible');
                        seatDiv.innerHTML = `
                            <div class="seat-num">${row}${col}</div>
                            <div class="seat-info">${studentText}</div>
                        `;
                    } else {
                        seatDiv.classList.add('blocked');
                        seatDiv.innerHTML = `
                            <div class="seat-num">${row}${col}</div>
                            <div class="seat-info">${studentText}</div>
                        `;
                    }
                } else {
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
