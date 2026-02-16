// Fetch exam seating via get_exam_summary and render per-room grids
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
        const seating = data.seating || [];
        const departments = data.departments || [];

        // Build a lookup for department exams (to get start_time/end_time reliably)
        const deptExamMap = {};
        departments.forEach(d => {
            const key = (d.department || '') + '|' + (d.exam_name || '') + '|' + (d.exam_date || '') + '|' + (d.session || '');
            deptExamMap[key] = { start_time: d.start_time || null, end_time: d.end_time || null };
        });

        // Group seating entries by room id/building+number
        const seatingByRoom = {};
        seating.forEach(s => {
            const key = s.room_building + '|' + s.room_number;
            if (!seatingByRoom[key]) seatingByRoom[key] = [];
            seatingByRoom[key].push(s);
        });

        if (!rooms.length) {
            container.innerHTML = '<p style="color:#666;">No rooms configured for this exam.</p>';
            return;
        }

        container.innerHTML = '';

        rooms.forEach(room => {
            const key = room.building + '|' + room.room_number;
            const seats = seatingByRoom[key] || [];

            const roomCard = document.createElement('div');
            roomCard.className = 'room-card';

            const header = document.createElement('div');
            header.className = 'room-header';
            header.innerHTML = `
                <div>
                  <strong>${room.building} — ${room.room_number}</strong>
                  <div class="room-meta">Capacity: ${room.capacity}</div>
                </div>
                <div class="room-actions">
                  <button class="view-btn" data-room-id="${room.id}">Edit</button>
                  <button class="delete-btn" data-room-id="${room.id}">Delete</button>
                </div>
            `;

            roomCard.appendChild(header);

            // Group seating by department and collect exam + student metadata
            const deptMetadata = {};
            seats.forEach(s => {
                const dept = s.department || 'Unknown';
                if (!deptMetadata[dept]) {
                    deptMetadata[dept] = {
                        exams: new Set(),
                        students: {}
                    };
                }
                
                // Collect unique exams for this department, using departments data for times
                const key = (s.department || '') + '|' + (s.exam_name || '') + '|' + (s.exam_date || '') + '|' + (s.exam_session || '');
                const times = deptExamMap[key] || {};
                const st = times.start_time ? (' ' + times.start_time) : '';
                const et = times.end_time ? (' - ' + times.end_time) : '';
                const examStr = (s.exam_name || 'Unknown') + ' (' + (s.exam_date || 'N/A') + ' - ' + (s.exam_session || 'N/A') + ')' + (st || '') + (et || '');
                deptMetadata[dept].exams.add(examStr);
                
                // Collect students by semester/year
                if (s.semester && s.year) {
                    const semKey = 'Sem ' + s.semester + ' (Year ' + s.year + ')';
                    deptMetadata[dept].students[semKey] = (deptMetadata[dept].students[semKey] || 0) + 1;
                }
            });

            // Render department metadata section
            Object.keys(deptMetadata).forEach(dept => {
                const meta = deptMetadata[dept];
                const metaDiv = document.createElement('div');
                metaDiv.className = 'dept-meta-section';
                
                let metaHTML = '<div class="dept-meta-name">' + dept + '</div>';
                
                // Add exams
                meta.exams.forEach(exam => {
                    metaHTML += '<div class="dept-meta-exam"><strong>Exam:</strong> ' + exam + '</div>';
                });
                
                // Add students per semester/year
                Object.keys(meta.students).forEach(sem => {
                    metaHTML += '<div class="dept-meta-students"><strong>Students:</strong> ' + sem + ' (' + meta.students[sem] + ')</div>';
                });
                
                metaDiv.innerHTML = metaHTML;
                roomCard.appendChild(metaDiv);
            });

            // Create grid with dynamic rows based on room capacity (5 columns fixed)
            const grid = document.createElement('div');
            grid.className = 'seating-grid';

            // Build a map of seat_code -> seat data
            const seatMap = {};
            seats.forEach(s => { if (s.seat_code) seatMap[s.seat_code] = s; });

            // Determine rows needed from room capacity (5 seats per row)
            const colsPerRow = 5;
            const rowsNeeded = Math.max(1, Math.ceil(Number(room.capacity) / colsPerRow));
            const rows = [];
            for (let i = 0; i < rowsNeeded; i++) {
                rows.push(String.fromCharCode('A'.charCodeAt(0) + i));
            }

            for (let r = 0; r < rowsNeeded; r++) {
                for (let c = 1; c <= colsPerRow; c++) {
                    const seatCode = rows[r] + c;
                    const cell = document.createElement('div');
                    cell.className = 'seat-cell';
                    const s = seatMap[seatCode];
                    if (s) {
                        cell.innerHTML = `<div style="font-weight:700">${seatCode}</div><div style="color:#333;">${s.registration_number || ''}</div><div style="color:#666;font-size:0.8rem">${s.department || ''}</div>`;
                        cell.classList.remove('empty');
                    } else {
                        cell.classList.add('empty');
                        cell.innerHTML = `<div style="font-weight:700">${seatCode}</div><div class="empty-seat">Empty</div>`;
                    }
                    grid.appendChild(cell);
                }
            }

            roomCard.appendChild(grid);
            container.appendChild(roomCard);
        });

        // Attach click handlers for Edit buttons: open modal to edit room seating
        document.querySelectorAll('.room-actions .view-btn').forEach(btn => {
            btn.addEventListener('click', e => {
                const rid = e.currentTarget.dataset.roomId;
                openEditModal(rid);
            });
        });

        // Modal helper functions and handlers
        const modal = document.getElementById('editRoomModal');
        const modalTitle = document.getElementById('editModalTitle');
        const modalBody = document.getElementById('editModalBody');
        const closeModalBtn = document.getElementById('closeEditModal');
        const saveRoomBtn = document.getElementById('saveRoomBtn');


        let currentRoomId = null;
        let currentRoom = null;
        let currentAllocMap = {}; // seat_code -> alloc
        let examStudents = []; // list of {registration_number, name, department}

        function openEditModal(roomId) {
            currentRoomId = roomId;
            modalTitle.textContent = 'Edit Room — loading...';
            modalBody.innerHTML = '<p style="color:#666;">Loading room details...</p>';
            modal.style.display = 'flex';

            fetch(`/get_room_details/?room_id=${roomId}`)
            .then(r => r.json())
            .then(data => {
                if (data.status !== 'success') {
                    modalBody.innerHTML = `<p style="color:red;">Error: ${data.message || 'Failed to load room'}</p>`;
                    return;
                }

                currentRoom = data.room;
                currentAllocMap = {};
                (data.allocations || []).forEach(a => { currentAllocMap[a.seat_code] = a; });
                examStudents = data.exam_students || [];

                renderEditModal();
            })
            .catch(err => {
                modalBody.innerHTML = `<p style="color:red;">Error loading room: ${err.message}</p>`;
            });
        }

        function renderEditModal() {
            modalTitle.textContent = `${currentRoom.building} — ${currentRoom.room_number} (Capacity: ${currentRoom.capacity})`;

            const colsPerRow = 5;
            const rowsNeeded = Math.max(1, Math.ceil(Number(currentRoom.capacity) / colsPerRow));
            const rows = [];
            for (let i = 0; i < rowsNeeded; i++) rows.push(String.fromCharCode('A'.charCodeAt(0) + i));

            let html = '<div style="display:flex;flex-direction:column;gap:10px;">';
            html += '<div style="background:#e3f2fd;padding:10px;border-radius:4px;color:#333;font-size:0.9rem;">';
            html += '<strong>New Interface:</strong> Click the <strong style="color:#1976d2;">Edit</strong> button on each seat to add/update a student with full details (exam info, times, etc.). This protects existing data.';
            html += '</div>';
            html += '<div style="display:grid;grid-template-columns: repeat(5, 1fr); gap:6px;">';

            for (let r = 0; r < rowsNeeded; r++) {
                for (let c = 1; c <= colsPerRow; c++) {
                    const seatCode = rows[r] + c;
                    const alloc = currentAllocMap[seatCode];
                    const selected = alloc ? alloc.registration_number : '';
                    const deptLabel = alloc ? alloc.department : '';

                    html += `<div class="seat-cell" data-seat="${seatCode}" data-col="${c}">`;
                    html += `<div style="font-weight:700">${seatCode}</div>`;
                    html += `<div style="margin-top:6px; display:flex; flex-direction:column; gap:4px;">`;
                    html += `<div style="font-size:0.75rem; color:#666; min-height:32px; padding:4px; background:#fafafa; border-radius:3px;">${selected || '<em>Empty</em>'}</div>`;
                    html += `<button class="edit-seat-btn" data-seat="${seatCode}" data-col="${c}" style="width:100%; padding:4px; font-size:0.75rem; background:#1976d2; color:#fff; border:none; border-radius:3px; cursor:pointer;">Edit</button>`;
                    html += `</div>`;
                    html += `</div>`;
                }
            }

            html += '</div></div>';
            modalBody.innerHTML = html;

            // Attach edit button handlers
            document.querySelectorAll('.edit-seat-btn').forEach(btn => {
                btn.addEventListener('click', e => {
                    const seatCode = btn.dataset.seat;
                    const col = Number(btn.dataset.col || 0);
                    const row = seatCode[0] || '';
                    const alloc = currentAllocMap[seatCode];
                    openSeatEditorModal(seatCode, row, col, alloc);
                });
            });
        }

        // Detailed seat editor modal
        function openSeatEditorModal(seatCode, row, col, existingAlloc) {
            const editorContainer = document.createElement('div');
            editorContainer.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.6);display:flex;align-items:center;justify-content:center;z-index:2000;';
            
            const regVal = existingAlloc ? (existingAlloc.registration_number || '') : '';
            const deptVal = existingAlloc ? (existingAlloc.department || '') : '';
            const examNameVal = existingAlloc ? (existingAlloc.exam_name || '') : '';
            const examDateVal = existingAlloc ? (existingAlloc.exam_date || '') : '';
            const sessionVal = existingAlloc ? (existingAlloc.exam_session || '1st Half') : '1st Half';

            // Helper: Convert 24-hour time to 12-hour AM/PM format
            const format12hr = (time24) => {
                if (!time24) return '';
                const parts = time24.split(':');
                const hours = parseInt(parts[0], 10);
                const minutes = parts[1] || '00';
                const ampm = hours >= 12 ? 'PM' : 'AM';
                const hours12 = hours % 12 || 12;
                return `${hours12}:${minutes} ${ampm}`;
            };

            const formHTML = `
                <div style="background:#fff;border-radius:8px;padding:20px;width:90%;max-width:580px;max-height:90vh;overflow-y:auto;">
                    <h4 style="margin-top:0;color:#1976d2;">✎ Edit Seat ${seatCode}</h4>
                    ${existingAlloc && existingAlloc.registration_number ? `<div style="background:#fff3cd;padding:10px;border-radius:4px;margin-bottom:12px;border-left:4px solid #ff9800;color:#333;font-size:0.9rem;"><strong>Current Student:</strong> ${existingAlloc.registration_number} (${existingAlloc.department})</div>` : ''}
                    
                    <div style="background:#f9f9f9;padding:12px;border-radius:4px;margin-bottom:16px;border-left:4px solid #1976d2;">
                        <strong style="color:#333;">Exam Details</strong> (can edit per seat)
                    </div>
                    
                    <div style="display:flex;flex-direction:column;gap:12px;">
                        <!-- Exam Details Section -->
                        <div>
                            <label style="font-weight:600;font-size:0.85rem;color:#333;">Exam Name *</label>
                            <input id="editor-exam-name" type="text" placeholder="e.g., final exam, KJYHTG" style="width:100%;padding:8px;margin-top:4px;border:1px solid #ddd;border-radius:4px;box-sizing:border-box;" value="${examNameVal}">
                        </div>
                        
                        <div>
                            <label style="font-weight:600;font-size:0.85rem;color:#333;">Exam Date (YYYY-MM-DD) *</label>
                            <input id="editor-exam-date" type="text" placeholder="e.g., 2026-02-20" style="width:100%;padding:8px;margin-top:4px;border:1px solid #ddd;border-radius:4px;box-sizing:border-box;" value="${examDateVal}">
                        </div>
                        
                        <div>
                            <label style="font-weight:600;font-size:0.85rem;color:#333;">Exam Timing (24-hour format HH:MM:SS)</label>
                            <div style="display:grid;grid-template-columns: 1fr 1fr;gap:8px;margin-top:4px;">
                                <div>
                                    <label style="font-size:0.8rem;color:#666;">Start Time</label>
                                    <div style="display:flex;gap:8px;align-items:center;">
                                        <input id="editor-start-time" type="text" placeholder="13:00:00 or 1:00" style="flex:1;padding:6px;border:1px solid #ddd;border-radius:3px;box-sizing:border-box;font-size:0.85rem;">
                                        <select id="editor-start-ampm" style="padding:6px;border:1px solid #ddd;border-radius:3px;background:#fff;font-size:0.85rem;">
                                            <option value="">(24h)</option>
                                            <option value="AM">AM</option>
                                            <option value="PM">PM</option>
                                        </select>
                                        <span id="start-time-display" style="font-size:0.8rem;color:#1976d2;font-weight:600;min-width:50px;"></span>
                                    </div>
                                </div>
                                <div>
                                    <label style="font-size:0.8rem;color:#666;">End Time</label>
                                    <div style="display:flex;gap:8px;align-items:center;">
                                        <input id="editor-end-time" type="text" placeholder="17:00:00 or 5:00" style="flex:1;padding:6px;border:1px solid #ddd;border-radius:3px;box-sizing:border-box;font-size:0.85rem;">
                                        <select id="editor-end-ampm" style="padding:6px;border:1px solid #ddd;border-radius:3px;background:#fff;font-size:0.85rem;">
                                            <option value="">(24h)</option>
                                            <option value="AM">AM</option>
                                            <option value="PM">PM</option>
                                        </select>
                                        <span id="end-time-display" style="font-size:0.8rem;color:#1976d2;font-weight:600;min-width:50px;"></span>
                                    </div>
                                </div>
                            </div>
                        </div>
                        
                        <div>
                            <label style="font-weight:600;font-size:0.85rem;color:#333;">Exam Session (Half) *</label>
                            <input id="editor-session" type="text" placeholder="e.g., 1st Half, 2nd Half" style="width:100%;padding:8px;margin-top:4px;border:1px solid #ddd;border-radius:4px;box-sizing:border-box;" value="${sessionVal}">
                        </div>
                        
                        <div style="background:#f9f9f9;padding:12px;border-radius:4px;margin-top:8px;border-left:4px solid #4caf50;">
                            <strong style="color:#333;">Student Details</strong> (can edit per seat)
                        </div>
                        
                        <div>
                            <label style="font-weight:600;font-size:0.85rem;color:#333;">Registration Number *</label>
                            <input id="editor-reg" type="text" placeholder="e.g., BBA009" style="width:100%;padding:8px;margin-top:4px;border:1px solid #ddd;border-radius:4px;box-sizing:border-box;" value="${regVal}">
                            <small style="color:#999;">Or leave empty and click "Remove Student" to delete this student</small>
                        </div>
                        
                        <div>
                            <label style="font-weight:600;font-size:0.85rem;color:#333;">Department *</label>
                            <input id="editor-dept" type="text" placeholder="e.g., BBA, CSE, BCA" style="width:100%;padding:8px;margin-top:4px;border:1px solid #ddd;border-radius:4px;box-sizing:border-box;" value="${deptVal}">
                        </div>
                        
                        <div style="display:grid;grid-template-columns: 1fr 1fr;gap:8px;">
                            <div>
                                <label style="font-weight:600;font-size:0.85rem;color:#333;">Semester</label>
                                <input id="editor-semester" type="text" placeholder="e.g., 1, 2, 3" style="width:100%;padding:8px;margin-top:4px;border:1px solid #ddd;border-radius:4px;box-sizing:border-box;">
                            </div>
                            <div>
                                <label style="font-weight:600;font-size:0.85rem;color:#333;">Year</label>
                                <input id="editor-year" type="text" placeholder="e.g., 2026" style="width:100%;padding:8px;margin-top:4px;border:1px solid #ddd;border-radius:4px;box-sizing:border-box;">
                            </div>
                        </div>
                    </div>
                    
                    <div style="margin-top:16px;display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;">
                        <button id="editor-cancel-btn" style="padding:8px 16px;background:#ccc;border:none;border-radius:4px;cursor:pointer;font-size:0.9rem;">Cancel</button>
                        ${existingAlloc && existingAlloc.registration_number ? `<button id="editor-remove-btn" style="padding:8px 16px;background:#e53935;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:0.9rem;font-weight:600;">🗑 Remove Student</button>` : ''}
                        <button id="editor-save-btn" style="padding:8px 16px;background:#4caf50;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:0.9rem;font-weight:600;">Save Seat</button>
                    </div>
                </div>
            `;

            editorContainer.innerHTML = formHTML;
            document.body.appendChild(editorContainer);

            const startTimeInput = editorContainer.querySelector('#editor-start-time');
            const startAmpm = editorContainer.querySelector('#editor-start-ampm');
            const endTimeInput = editorContainer.querySelector('#editor-end-time');
            const endAmpm = editorContainer.querySelector('#editor-end-ampm');
            const startTimeDisplay = editorContainer.querySelector('#start-time-display');
            const endTimeDisplay = editorContainer.querySelector('#end-time-display');

            // Setup time display conversion
            const to24 = (timeStr, ampm) => {
                if (!timeStr) return '';
                // If time already in 24h with hour >=12, assume it's 24h
                const parts = timeStr.split(':').map(p => p.trim());
                let h = parseInt(parts[0], 10);
                const m = parts[1] || '00';
                const s = parts[2] || '00';
                if (isNaN(h)) return '';
                if (ampm === 'AM' || ampm === 'PM') {
                    if (ampm === 'AM') {
                        if (h === 12) h = 0;
                    } else {
                        if (h !== 12) h = h + 12;
                    }
                }
                return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
            };

            const updateTimeDisplays = () => {
                const startVal = startTimeInput.value.trim();
                const endVal = endTimeInput.value.trim();
                const start24 = to24(startVal, startAmpm.value);
                const end24 = to24(endVal, endAmpm.value);
                startTimeDisplay.textContent = start24 ? format12hr(start24) : '';
                endTimeDisplay.textContent = end24 ? format12hr(end24) : '';
            };

            startTimeInput.addEventListener('input', updateTimeDisplays);
            endTimeInput.addEventListener('input', updateTimeDisplays);
            startAmpm.addEventListener('change', updateTimeDisplays);
            endAmpm.addEventListener('change', updateTimeDisplays);

            // Helper: convert 24h string to editable input + AM/PM
            const from24ToInput = (time24) => {
                if (!time24) return { time: '', ampm: '' };
                const parts = time24.split(':');
                let h = parseInt(parts[0], 10);
                const m = parts[1] || '00';
                const ampm = h >= 12 ? 'PM' : 'AM';
                const h12 = h % 12 || 12;
                return { time: `${h12}:${m}`, ampm };
            };

            // Fill exam fields from another allocation of the same department if available
            const fillFromDepartmentDefaults = (dept) => {
                if (!dept) return;
                const allocs = Object.values(currentAllocMap || {});
                for (let i = 0; i < allocs.length; i++) {
                    const a = allocs[i];
                    if (!a) continue;
                    if ((a.department || '').toLowerCase() === dept.toLowerCase()) {
                        // Use first matching allocation that has exam_date
                        if (a.exam_date) {
                            const examDateEl = editorContainer.querySelector('#editor-exam-date');
                            const sessionEl = editorContainer.querySelector('#editor-session');
                            const startEl = editorContainer.querySelector('#editor-start-time');
                            const endEl = editorContainer.querySelector('#editor-end-time');
                            const startAmpEl = editorContainer.querySelector('#editor-start-ampm');
                            const endAmpEl = editorContainer.querySelector('#editor-end-ampm');
                            if (!examDateEl.value.trim()) examDateEl.value = a.exam_date || '';
                            if (!sessionEl.value.trim()) sessionEl.value = a.exam_session || '';
                            if (a.start_time) {
                                const s = from24ToInput(a.start_time);
                                if (!startEl.value.trim()) startEl.value = s.time;
                                if (!startAmpEl.value) startAmpEl.value = s.ampm;
                            }
                            if (a.end_time) {
                                const e = from24ToInput(a.end_time);
                                if (!endEl.value.trim()) endEl.value = e.time;
                                if (!endAmpEl.value) endAmpEl.value = e.ampm;
                            }
                            updateTimeDisplays();
                            break;
                        }
                    }
                }
            };

            // When department input changes, attempt to prefill missing exam fields from that department
            const deptInputEl = editorContainer.querySelector('#editor-dept');
            if (deptInputEl) {
                deptInputEl.addEventListener('blur', (ev) => {
                    const v = ev.target.value.trim();
                    if (v) fillFromDepartmentDefaults(v);
                });
            }

            // If editing existing allocation, populate start/end AM/PM selectors from its times
            if (existingAlloc) {
                if (existingAlloc.start_time) {
                    const s = from24ToInput(existingAlloc.start_time);
                    startTimeInput.value = s.time;
                    startAmpm.value = s.ampm;
                }
                if (existingAlloc.end_time) {
                    const e = from24ToInput(existingAlloc.end_time);
                    endTimeInput.value = e.time;
                    endAmpm.value = e.ampm;
                }
                updateTimeDisplays();
            } else {
                // If new student and department already exists in room, prefill fields
                if (deptVal) {
                    fillFromDepartmentDefaults(deptVal);
                }
            }

            const cancelBtn = editorContainer.querySelector('#editor-cancel-btn');
            const removeBtn = editorContainer.querySelector('#editor-remove-btn');
            const saveBtn = editorContainer.querySelector('#editor-save-btn');

            cancelBtn.addEventListener('click', () => editorContainer.remove());

            // Remove student button
            if (removeBtn) {
                removeBtn.addEventListener('click', () => {
                    const confirmed = confirm(`Delete student ${regVal} from seat ${seatCode}?`);
                    if (!confirmed) return;

                    removeBtn.disabled = true;
                    fetch('/add_student_to_seat/', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            room_id: currentRoomId,
                            seat: seatCode,
                            registration: '',  // Empty = remove
                            department: '',
                            row: row,
                            column: col
                        })
                    })
                    .then(r => r.json())
                    .then(data => {
                        if (data.status === 'success') {
                            alert(`✓ Student ${regVal} removed from seat ${seatCode}`);
                            editorContainer.remove();
                            window.location.reload();
                        } else {
                            alert(`Error: ${data.message || 'Failed to remove student'}`);
                            removeBtn.disabled = false;
                        }
                    })
                    .catch(err => {
                        alert(`Error: ${err.message}`);
                        removeBtn.disabled = false;
                    });
                });
            }
            
            saveBtn.addEventListener('click', () => {
                const reg = editorContainer.querySelector('#editor-reg').value.trim();
                const dept = editorContainer.querySelector('#editor-dept').value.trim();
                const examName = editorContainer.querySelector('#editor-exam-name').value.trim();
                // Attempt to autofill missing exam fields from department defaults before reading values
                fillFromDepartmentDefaults(dept);
                const examDate = editorContainer.querySelector('#editor-exam-date').value.trim();
                const session = editorContainer.querySelector('#editor-session').value.trim();
                const startTimeRaw = editorContainer.querySelector('#editor-start-time').value.trim();
                const startAmp = editorContainer.querySelector('#editor-start-ampm').value;
                const endTimeRaw = editorContainer.querySelector('#editor-end-time').value.trim();
                const endAmp = editorContainer.querySelector('#editor-end-ampm').value;
                const startTime = to24(startTimeRaw, startAmp);
                const endTime = to24(endTimeRaw, endAmp);
                const semester = editorContainer.querySelector('#editor-semester').value.trim();
                const year = editorContainer.querySelector('#editor-year').value.trim();

                if (!examName || !examDate) {
                    alert('Exam Name and Exam Date are required');
                    return;
                }

                if (!reg) {
                    alert('Registration Number is required to save a student. (Or click "Remove Student" to delete.)');
                    return;
                }

                saveBtn.disabled = true;
                fetch('/add_student_to_seat/', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        room_id: currentRoomId,
                        seat: seatCode,
                        registration: reg,
                        department: dept,
                        exam_name: examName,
                        exam_date: examDate,
                        exam_session: session,
                        start_time: startTime,
                        end_time: endTime,
                        semester: semester,
                        year: year,
                        row: row,
                        column: col
                    })
                })
                .then(r => r.json())
                .then(data => {
                    if (data.status === 'success') {
                        const displayStart = startTime ? ` Start: ${format12hr(startTime)}` : '';
                        const displayEnd = endTime ? ` End: ${format12hr(endTime)}` : '';
                        const displaySem = semester ? ` Sem: ${semester}` : '';
                        const displayYear = year ? ` Year: ${year}` : '';
                        alert(`✓ Seat ${seatCode} ${data.action}!\n\nExam: ${examName}\nDate: ${examDate}\nSession: ${session}${displayStart}${displayEnd}\nStudent: ${reg}${displaySem}${displayYear}`);
                        editorContainer.remove();
                        window.location.reload();
                    } else {
                        alert(`Error: ${data.message || 'Failed to save'}`);
                        saveBtn.disabled = false;
                    }
                })
                .catch(err => {
                    alert(`Error: ${err.message}`);
                    saveBtn.disabled = false;
                });
            });
        }



        // Close modal
        closeModalBtn.addEventListener('click', () => { modal.style.display = 'none'; });

        // Save button - now just shows hint (use per-seat Edit buttons instead)
        saveRoomBtn.addEventListener('click', () => {
            alert('Use the blue "Edit" buttons on each seat to add/update students individually. This ensures existing data (exam details, other departments) is not affected.');
        });

        // Attach click handlers for Delete buttons
        document.querySelectorAll('.room-actions .delete-btn').forEach(btn => {
            btn.addEventListener('click', e => {
                const rid = e.currentTarget.dataset.roomId;
                const confirmed = confirm('Delete this room? This will remove the room and any saved seat allocations.');
                if (!confirmed) return;

                // Disable button while request is in progress
                btn.disabled = true;
                const card = btn.closest('.room-card');

                fetch('/delete_room/', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
                    body: JSON.stringify({ room_id: rid })
                })
                .then(async res => {
                    const text = await res.text();
                    const ct = res.headers.get('content-type') || '';
                    if (ct.includes('application/json')) {
                        const json = JSON.parse(text || '{}');
                        return { ok: res.ok, json };
                    } else {
                        // Server returned HTML (error page) or plain text; surface it to user
                        throw new Error(text || `Server responded with status ${res.status}`);
                    }
                })
                .then(({ ok, json }) => {
                    if (json.status === 'success') {
                        if (card) card.remove();
                    } else {
                        alert('Error deleting room: ' + (json.message || 'Unknown'));
                    }
                })
                .catch(err => {
                    // Trim HTML tags if present and show a short message
                    let msg = (err.message || String(err)).trim();
                    // If HTML, show a short message and log full HTML for debugging
                    if (msg.startsWith('<')) {
                        console.error('Server HTML response while deleting room:', msg);
                        msg = 'Server returned an error. Check server logs.';
                    }
                    alert('Error deleting room: ' + msg);
                })
                .finally(() => { btn.disabled = false; });
            });
        });
    })
    .catch(err => {
        container.innerHTML = `<p style="color:red;">Error loading seating: ${err.message}</p>`;
    });
});
