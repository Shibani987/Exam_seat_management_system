// =============================
// CSRF Helper
// =============================
function getCookie(name) {
    let cookieValue = null;
    if (document.cookie && document.cookie !== '') {
        const cookies = document.cookie.split(';');
        for (let cookie of cookies) {
            cookie = cookie.trim();
            if (cookie.startsWith(name + '=')) {
                cookieValue = decodeURIComponent(cookie.substring(name.length + 1));
                break;
            }
        }
    }
    return cookieValue;
}

const csrftoken = getCookie('csrftoken');

// =============================
// GLOBAL STATE
// =============================
let examId = null;
let selectedDepartments = [];
let roomsList = [];
let allUploadedFiles = [];
let selectedFiles = [];
let selectedFilesData = null; // Store merged file + student data from Step 4
let currentSeatingData = null; // Store current seating for lock feature

// =============================
// TIME CONVERSION HELPER FUNCTIONS
// =============================
function generateHourOptions(selectedHour = '12') {
    console.log('[DEBUG] generateHourOptions called with selectedHour:', selectedHour);
    let options = '<option value="">Select Hour</option>';
    for (let i = 1; i <= 12; i++) {
        const padded = String(i).padStart(2, '0');
        const selected = selectedHour === padded || selectedHour === i ? 'selected' : '';
        options += `<option value="${padded}" ${selected}>${padded}</option>`;
    }
    console.log('[DEBUG] hour options generated');
    return options;
}

function generateMinuteOptions(selectedMinute = '00') {
    console.log('[DEBUG] generateMinuteOptions called with selectedMinute:', selectedMinute);
    let options = '<option value="">Select Minute</option>';
    for (let i = 0; i < 60; i++) {
        const padded = String(i).padStart(2, '0');
        const selected = selectedMinute === padded || selectedMinute === i? 'selected' : '';
        options += `<option value="${padded}" ${selected}>${padded}</option>`;
    }
    console.log('[DEBUG] minute options generated');
    return options;
}

function convertTo24HourFormat(hour12, minute, ampm) {
    let hour24 = parseInt(hour12);
    if (ampm === 'PM' && hour24 !== 12) {
        hour24 += 12;
    } else if (ampm === 'AM' && hour24 === 12) {
        hour24 = 0;
    }
    return `${String(hour24).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function convertTo12HourFormat(timeStr) {
    if (!timeStr || timeStr === '') {
        return { hour: '12', minute: '00', ampm: 'AM' };
    }
    const [hours, minutes] = timeStr.split(':');
    let hour24 = parseInt(hours);
    let ampm = hour24 >= 12 ? 'PM' : 'AM';
    let hour12 = hour24 % 12 || 12;
    return {
        hour: String(hour12).padStart(2, '0'),
        minute: String(parseInt(minutes)).padStart(2, '0'),
        ampm: ampm
    };
}

// =============================
// GLOBAL UI ELEMENTS
// =============================
const completeSetupBtn = document.getElementById('completeSetupBtn');

// Complete Setup Button Handler (Final step - saves everything permanently)
if (completeSetupBtn) {
    completeSetupBtn.onclick = e => {
        e.preventDefault();
        
        if (!examId) {
            alert('Error: No exam ID found');
            return;
        }
        
        console.log('[COMPLETE SETUP] Marking exam as permanently completed...');
        
        // Show confirmation
        const confirmed = confirm('Are you sure you want to finalize this exam setup?\n\nOnce confirmed, all data will be permanently saved to the database and a NEW exam ID will be created for the next exam.');
        if (!confirmed) return;
        
        fetch('/complete-exam-setup/', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrftoken },
            body: JSON.stringify({ exam_id: examId })
        })
        .then(r => {
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            return r.json();
        })
        .then(result => {
            if (result.status !== 'success') {
                alert('Error: ' + result.message);
                return;
            }
            
            console.log('[COMPLETE SETUP] Exam permanently saved!');
            alert('Exam setup completed successfully. All data has been permanently saved.');
            
            // Disable button after completion
            completeSetupBtn.disabled = true;
            completeSetupBtn.textContent = 'Setup Complete';
            
            // Fire background init for the next temporary exam (best-effort)
            try {
                fetch('/init-temp-exam/', { method: 'GET', headers: { 'X-CSRFToken': csrftoken, 'Content-Type': 'application/json' }, keepalive: true })
                    .then(() => console.log('[COMPLETE SETUP] Background temp exam initialized'))
                    .catch(e => console.warn('[COMPLETE SETUP] Background init failed', e));
            } catch (e) {
                console.warn('[COMPLETE SETUP] Background init not supported', e);
            }

            // Redirect to dashboard
            console.log('[COMPLETE SETUP] Redirecting to dashboard...');
            // Use absolute URL as requested
            setTimeout(() => { window.location.href = 'https://exam-seat-management-system.onrender.com'; }, 250);
        })
        .catch(err => {
            console.error('[COMPLETE SETUP] Error:', err);
            alert('Error: ' + err.message);
        });
    };
}

// =============================
// INITIALIZE TEMP EXAM ON PAGE LOAD
// =============================
function initTempExam() {
    console.log('Initializing temporary exam...');
    
    const initUrl = '/init-temp-exam/';
    console.log('Calling:', initUrl);
    
    fetch(initUrl, {
        method: 'GET',
        headers: { 
            'X-CSRFToken': csrftoken,
            'Content-Type': 'application/json'
        }
    })
    .then(r => {
        console.log('Init response status:', r.status);
        if (!r.ok) {
            throw new Error(`HTTP ${r.status}: ${r.statusText}`);
        }
        return r.json();
    })
    .then(data => {
        console.log('Init response data:', data);
        if (data.status === 'success') {
            examId = data.exam_id;
            console.log('✓ Temporary exam created with ID:', examId);
            document.title = `Exam Setup - ID: ${examId}`;
        } else {
            console.error('Error creating temporary exam:', data);
            alert('Error creating temporary exam: ' + (data.message || 'Unknown error'));
        }
    })
    .catch(err => {
        console.error('Init exam error:', err);
        alert('Failed to initialize exam: ' + err.message + '\nCheck browser console for details.');
    });
}

// Initialize exam when page loads
document.addEventListener('DOMContentLoaded', () => {
    console.log('Page loaded, initializing exam...');
    initTempExam();
});

// =============================
// AUTO CLEANUP ON PAGE EXIT (Before Complete)
// =============================
window.addEventListener('beforeunload', (e) => {
    // Only delete if exam is still temporary (not completed)
    if (examId) {
        const data = JSON.stringify({ exam_id: examId });
        navigator.sendBeacon('/delete-temp-exam/', data);
    }
});

// =============================
// STEP ELEMENTS
// =============================
const step1 = document.getElementById('step1');
const step2 = document.getElementById('step2');
const step3 = document.getElementById('step3');
const step4 = document.getElementById('step4');
const step5 = document.getElementById('step5');
const step6 = document.getElementById('step6');

const step2Content = document.getElementById('step2Content');
const step3Content = document.getElementById('step3Content');
const step4Content = document.getElementById('step4Content');
const step5Content = document.getElementById('step5Content');
const step6Content = document.getElementById('step6Content');

// =============================
// STEP 1 - EXAM SETUP
// =============================
const examForm = document.getElementById('examForm');
const examName = document.getElementById('examName');
const examStartDate = document.getElementById('examStartDate');
const examEndDate = document.getElementById('examEndDate');
const proceedBtn = document.getElementById('proceedBtn');
if (proceedBtn) {
    proceedBtn.disabled = true;
}

function checkForm() {
    const valid =
        examName.value &&
        examStartDate.value &&
        examEndDate.value &&
        examStartDate.value <= examEndDate.value;

    if (proceedBtn) {
        proceedBtn.disabled = !valid;
        proceedBtn.classList.toggle('enabled', valid);
    }
}

examName.addEventListener('input', checkForm);
examStartDate.addEventListener('change', checkForm);
examEndDate.addEventListener('change', checkForm);

examForm.addEventListener('submit', e => {
    e.preventDefault();
    
    // Check if exam_id is set
    if (!examId) {
        alert('Error: Exam ID not initialized. Please refresh the page.');
        console.error('examId is null. Cannot proceed.');
        return;
    }
    
    console.log('Submitting exam form with ID:', examId);
    fetch('/create_exam/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrftoken },
        body: JSON.stringify({
            exam_id: examId,
            name: examName.value,
            start_date: examStartDate.value,
            end_date: examEndDate.value
        })
    })
    .then(r => r.json())
    .then(r => {
        console.log('Create exam response:', r);
        if (r.status === 'success') {
            step1.classList.remove('active');
            step1.classList.add('completed');
            step2.classList.add('active');
            examForm.style.display = 'none';
            step2Content.style.display = 'block';
        } else {
            alert('Error: ' + (r.message || 'Failed to create exam'));
            console.error('Create exam error:', r);
        }
    })
    .catch(err => {
        console.error('Fetch error:', err);
        alert('Error creating exam');
    });
});

// =============================
// STEP 2 - DEPARTMENTS & EXAMS
// =============================
const deptDivs = document.querySelectorAll('.department');
const examsContainer = document.getElementById('examsContainer');
const backBtn = document.getElementById('backBtn');
const nextBtn = document.getElementById('nextBtn');
let departmentExams = {};
if (nextBtn) {
    nextBtn.disabled = true;
}

deptDivs.forEach(dept => {
    dept.addEventListener('click', () => {
        const name = dept.dataset.name;
        dept.classList.toggle('selected');
        if (selectedDepartments.includes(name)) {
            selectedDepartments = selectedDepartments.filter(d => d !== name);
            delete departmentExams[name];
        } else {
            selectedDepartments.push(name);
            // Initialize with one blank exam so user fills exam data after selecting department
            departmentExams[name] = [{ name: '', code: '', date: '', session: '', start_time: '', end_time: '', start_hour: '12', start_minute: '00', start_ampm: 'AM', end_hour: '12', end_minute: '00', end_ampm: 'AM' }];
        }
        renderExamInputs();
        // After rendering, focus first exam name input if present
        setTimeout(() => {
            const firstInput = document.querySelector(`#exams-${name} .exam-name`);
            if (firstInput) firstInput.focus();
        }, 0);
    });
});

function renderExamInputs() {
    examsContainer.innerHTML = '';
    selectedDepartments.forEach(dept => {
        const deptSection = document.createElement('div');
        deptSection.className = 'dept-exam-section';
        deptSection.innerHTML = `
            <h3>${dept}</h3>
            <div class="exams-list" id="exams-${dept}"></div>
            <button class="add-exam-btn" data-dept="${dept}">+ Add Exam for ${dept}</button>
        `;
        examsContainer.appendChild(deptSection);
        renderDeptExams(dept);
    });

    document.querySelectorAll('.add-exam-btn').forEach(btn => {
        btn.addEventListener('click', e => {
            e.preventDefault();
            const dept = btn.dataset.dept;
            departmentExams[dept].push({ name: '', code: '', date: '', session: '', start_time: '', end_time: '', start_hour: '12', start_minute: '00', start_ampm: 'AM', end_hour: '12', end_minute: '00', end_ampm: 'AM' });
            renderDeptExams(dept);
        });
    });

    checkDeptInputs();
}

// Helper: check if an exam entry is fully filled
function isExamComplete(exam) {
    return Boolean(exam && exam.name && exam.code && exam.date && exam.session && exam.start_time && exam.end_time);
}

// Helper: show/hide warning under a department's exams list
function updateDeptWarning(dept) {
    const exams = departmentExams[dept] || [];
    const examsListEl = document.getElementById(`exams-${dept}`);
    if (!examsListEl) return;

    const warningId = `exam-warning-${dept}`;
    let warnEl = document.getElementById(warningId);

    const hasComplete = exams.some(isExamComplete);

    if (exams.length === 0) {
        if (!warnEl) {
            warnEl = document.createElement('div');
            warnEl.id = warningId;
            warnEl.className = 'exam-warning';
            warnEl.style.color = '#c00';
            warnEl.style.fontSize = '0.9rem';
            warnEl.style.marginTop = '8px';
            warnEl.textContent = 'Please add at least one exam (Name, Code, Date, Session, Start Time, End Time) for this department.';
            examsListEl.appendChild(warnEl);
        }
    } else if (!hasComplete) {
        if (!warnEl) {
            warnEl = document.createElement('div');
            warnEl.id = warningId;
            warnEl.className = 'exam-warning';
            warnEl.style.color = '#c00';
            warnEl.style.fontSize = '0.9rem';
            warnEl.style.marginTop = '8px';
            warnEl.textContent = 'Please fill at least one complete exam (Name, Code, Date, Session, Start Time, End Time) for this department.';
            examsListEl.appendChild(warnEl);
        }
    } else {
        if (warnEl) warnEl.remove();
    }
}

function renderDeptExams(dept) {
    console.log('[DEBUG] renderDeptExams called for dept:', dept);
    const examsList = document.getElementById(`exams-${dept}`);
    examsList.innerHTML = '';

    if (!departmentExams[dept] || departmentExams[dept].length === 0) {
        examsList.innerHTML = '<p style="color: #999; font-size: 0.9rem;">No exams added yet</p>';
        // remove any existing warning
        const existingWarn = document.getElementById(`exam-warning-${dept}`);
        if (existingWarn) existingWarn.remove();
        return;
    }

    departmentExams[dept].forEach((exam, idx) => {
        console.log('[DEBUG] Rendering exam:', exam);
        // Convert 24-hour times to 12-hour format for display
        const startTime12hr = exam.start_hour ? 
            { hour: exam.start_hour, minute: exam.start_minute, ampm: exam.start_ampm } :
            convertTo12HourFormat(exam.start_time);
        const endTime12hr = exam.end_hour ?
            { hour: exam.end_hour, minute: exam.end_minute, ampm: exam.end_ampm } :
            convertTo12HourFormat(exam.end_time);
        
        console.log('[DEBUG] Start time 12hr:', startTime12hr);
        console.log('[DEBUG] End time 12hr:', endTime12hr);
        
        // Store these for later use
        exam.start_hour = startTime12hr.hour;
        exam.start_minute = startTime12hr.minute;
        exam.start_ampm = startTime12hr.ampm;
        exam.end_hour = endTime12hr.hour;
        exam.end_minute = endTime12hr.minute;
        exam.end_ampm = endTime12hr.ampm;
        
        const examDiv = document.createElement('div');
        examDiv.className = 'exam-input-group';
        examDiv.innerHTML = `
            <div class="exam-row">
                <input type="text" class="exam-name" data-dept="${dept}" data-idx="${idx}" placeholder="Exam Name" value="${exam.name}">
                <input type="text" class="exam-code" data-dept="${dept}" data-idx="${idx}" placeholder="Paper Code" value="${exam.code}">
            </div>
            <div class="exam-row">
                <input type="date" class="exam-date" data-dept="${dept}" data-idx="${idx}" value="${exam.date}">
                <select class="exam-session" data-dept="${dept}" data-idx="${idx}">
                    <option value="">Select Session</option>
                    <option value="1st Half" ${exam.session === '1st Half' ? 'selected' : ''}>1st Half</option>
                    <option value="2nd Half" ${exam.session === '2nd Half' ? 'selected' : ''}>2nd Half</option>
                </select>
            </div>
            <div class="exam-row">
                <div class="time-input-group">
                    <label>Start Time</label>
                    <div class="time-selectors">
                        <select class="exam-start_hour" data-dept="${dept}" data-idx="${idx}">
                            ${generateHourOptions(exam.start_hour)}
                        </select>
                        <span>:</span>
                        <select class="exam-start_minute" data-dept="${dept}" data-idx="${idx}">
                            ${generateMinuteOptions(exam.start_minute)}
                        </select>
                        <select class="exam-start_ampm" data-dept="${dept}" data-idx="${idx}">
                            <option value="AM" ${exam.start_ampm === 'AM' ? 'selected' : ''}>AM</option>
                            <option value="PM" ${exam.start_ampm === 'PM' ? 'selected' : ''}>PM</option>
                        </select>
                    </div>
                </div>
                <div class="time-input-group">
                    <label>End Time</label>
                    <div class="time-selectors">
                        <select class="exam-end_hour" data-dept="${dept}" data-idx="${idx}">
                            ${generateHourOptions(exam.end_hour)}
                        </select>
                        <span>:</span>
                        <select class="exam-end_minute" data-dept="${dept}" data-idx="${idx}">
                            ${generateMinuteOptions(exam.end_minute)}
                        </select>
                        <select class="exam-end_ampm" data-dept="${dept}" data-idx="${idx}">
                            <option value="AM" ${exam.end_ampm === 'AM' ? 'selected' : ''}>AM</option>
                            <option value="PM" ${exam.end_ampm === 'PM' ? 'selected' : ''}>PM</option>
                        </select>
                    </div>
                </div>
                <button class="remove-exam-btn" data-dept="${dept}" data-idx="${idx}">Remove</button>
            </div>
        `;
        examsList.appendChild(examDiv);
    });

    examsList.querySelectorAll('.exam-name, .exam-code, .exam-date, .exam-session, .exam-start_hour, .exam-start_minute, .exam-start_ampm, .exam-end_hour, .exam-end_minute, .exam-end_ampm').forEach(input => {
        input.addEventListener('change', e => {
            const dept = e.target.dataset.dept;
            const idx = e.target.dataset.idx;
            const className = e.target.className.split(' ')[0];
            
            if (className.includes('start_hour') || className.includes('start_minute') || className.includes('start_ampm')) {
                // Convert 12-hour format to 24-hour format for storage
                const hour = parseInt(examsList.querySelector(`select.exam-start_hour[data-dept="${dept}"][data-idx="${idx}"]`).value);
                const minute = examsList.querySelector(`select.exam-start_minute[data-dept="${dept}"][data-idx="${idx}"]`).value;
                const ampm = examsList.querySelector(`select.exam-start_ampm[data-dept="${dept}"][data-idx="${idx}"]`).value;
                const time24hr = convertTo24HourFormat(hour, minute, ampm);
                departmentExams[dept][idx]['start_time'] = time24hr;
                departmentExams[dept][idx]['start_hour'] = hour;
                departmentExams[dept][idx]['start_minute'] = minute;
                departmentExams[dept][idx]['start_ampm'] = ampm;
            } else if (className.includes('end_hour') || className.includes('end_minute') || className.includes('end_ampm')) {
                // Convert 12-hour format to 24-hour format for storage
                const hour = parseInt(examsList.querySelector(`select.exam-end_hour[data-dept="${dept}"][data-idx="${idx}"]`).value);
                const minute = examsList.querySelector(`select.exam-end_minute[data-dept="${dept}"][data-idx="${idx}"]`).value;
                const ampm = examsList.querySelector(`select.exam-end_ampm[data-dept="${dept}"][data-idx="${idx}"]`).value;
                const time24hr = convertTo24HourFormat(hour, minute, ampm);
                departmentExams[dept][idx]['end_time'] = time24hr;
                departmentExams[dept][idx]['end_hour'] = hour;
                departmentExams[dept][idx]['end_minute'] = minute;
                departmentExams[dept][idx]['end_ampm'] = ampm;
            } else {
                const fieldType = className.replace('exam-', '');
                departmentExams[dept][idx][fieldType] = e.target.value;
            }
            
            checkDeptInputs();
        });
    });

    examsList.querySelectorAll('.remove-exam-btn').forEach(btn => {
        btn.addEventListener('click', e => {
            e.preventDefault();
            const dept = btn.dataset.dept;
            const idx = btn.dataset.idx;
            departmentExams[dept].splice(idx, 1);
            renderDeptExams(dept);
        });
    });

    // Update warning state for this dept after rendering
    try { updateDeptWarning(dept); } catch (err) { console.warn('updateDeptWarning failed:', err); }
}

function checkDeptInputs() {
    // Enable Next when at least one department is selected.
    // If a department has exams, require at least ONE fully filled exam (Name, Code, Date, Session).
    const hasDept = selectedDepartments.length >= 1;
    let allValid = hasDept;

    selectedDepartments.forEach(dept => {
        const exams = departmentExams[dept] || [];
        // Require at least one exam and at least one complete exam for selected departments
        const hasComplete = exams.some(isExamComplete);
        updateDeptWarning(dept);
        if (exams.length === 0 || !hasComplete) allValid = false;
    });

    if (nextBtn) {
        nextBtn.disabled = !allValid;
        nextBtn.classList.toggle('enabled', allValid);
    }
}

// Validate exam dates are within start and end date
function validateExamDates() {
    const startDate = new Date(examStartDate.value);
    const endDate = new Date(examEndDate.value);
    
    let invalidDates = [];
    
    selectedDepartments.forEach(dept => {
        (departmentExams[dept] || []).forEach((exam, idx) => {
            if (exam.date) {
                const examDate = new Date(exam.date);
                if (examDate < startDate || examDate > endDate) {
                    invalidDates.push({
                        dept: dept,
                        exam: exam.name,
                        date: exam.date,
                        startDate: examStartDate.value,
                        endDate: examEndDate.value
                    });
                }
            }
        });
    });
    
    return invalidDates;
}

if (backBtn) {
    backBtn.onclick = e => {
        e.preventDefault();
        step2.classList.remove('active');
        step1.classList.add('active');
        step2Content.style.display = 'none';
        examForm.style.display = 'block';
    };
}

if (nextBtn) {
    nextBtn.onclick = e => {
        e.preventDefault();
        
        // VALIDATION 1: Check if exam dates are within start and end date
        const invalidDates = validateExamDates();
        if (invalidDates.length > 0) {
            let errorMsg = 'EXAM DATE ERROR\n\n';
            errorMsg += `Exam dates must be between ${examStartDate.value} and ${examEndDate.value}\n\n`;
            errorMsg += 'Invalid exam dates found:\n\n';
            invalidDates.forEach(item => {
                errorMsg += `${item.dept} - ${item.exam}\nExam Date: ${item.date}\n\n`;
            });
            alert(errorMsg);
            return;
        }
        
        const payload = selectedDepartments.map(dept => ({ department: dept, exams: departmentExams[dept] }));
        fetch('/add_departments/', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrftoken },
            body: JSON.stringify({ exam_id: examId, departments: payload })
        })
        .then(r => r.json())
        .then(r => {
            if (r.status === 'success') {
                step2.classList.remove('active');
                step2.classList.add('completed');
                step3.classList.add('active');
                step2Content.style.display = 'none';
                step3Content.style.display = 'block';
            } else alert(r.message);
        });
    };
}

// =============================
// STEP 3 - ROOMS
// =============================
const buildingSelect = document.getElementById('buildingSelect');
const roomNumber = document.getElementById('roomNumber');
const roomCapacity = document.getElementById('roomCapacity');
const addRoomBtn = document.getElementById('addRoomBtn');
const roomList = document.getElementById('roomList');
const backStep3Btn = document.getElementById('backStep3Btn');
const proceedStep3Btn = document.getElementById('proceedStep3Btn');

function escapeHtml(str) {
    if (str === null || typeof str === 'undefined') return '';
    return String(str).replace(/[&<>"']/g, function(m) {
        return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[m];
    });
}

function getBuildingOptionsHtml() {
    let opts = '';
    if (buildingSelect) {
        for (let i = 0; i < buildingSelect.options.length; i++) {
            const o = buildingSelect.options[i];
            opts += `<option value="${escapeHtml(o.value)}">${escapeHtml(o.text)}</option>`;
        }
    } else {
        opts = '<option value="">Select Building</option><option value="Main Building">Main Building</option><option value="CMS">CMS</option>';
    }
    return opts;
}

function renderRooms() {
    roomList.innerHTML = '';
    if (roomsList.length === 0) {
        roomList.innerHTML = '<p style="color:#666; padding:10px;">No rooms added yet.</p>';
    } else {
        roomsList.forEach((r, idx) => {
            roomList.innerHTML += `
                <div class="room-item" data-idx="${idx}">
                    <label>Building</label>
                    <select class="room-building">${getBuildingOptionsHtml()}</select>
                    <label>Room Number</label>
                    <input type="text" class="room-number" value="${escapeHtml(r.room_number)}" placeholder="e.g., 303" />
                    <label>Capacity</label>
                    <input type="number" class="room-capacity" value="${escapeHtml(r.capacity)}" placeholder="e.g., 40" />
                    <button class="remove-room-btn">Remove</button>
                </div>
            `;
        });
    }

    // Wire up events for each rendered room item (update roomsList live, allow removal)
    const items = roomList.querySelectorAll('.room-item');
    items.forEach(item => {
        const idx = parseInt(item.dataset.idx, 10);
        const r = roomsList[idx];
        const sel = item.querySelector('.room-building');
        const num = item.querySelector('.room-number');
        const cap = item.querySelector('.room-capacity');
        const removeBtn = item.querySelector('.remove-room-btn');

        // set the select value (options were regenerated)
        if (sel) sel.value = r.building || '';

        // update model on change
        sel.addEventListener('change', e => { roomsList[idx].building = e.target.value; });
        num.addEventListener('input', e => { roomsList[idx].room_number = e.target.value; });
        cap.addEventListener('input', e => { roomsList[idx].capacity = e.target.value; });

        removeBtn.addEventListener('click', e => {
            e.preventDefault();
            roomsList.splice(idx, 1);
            renderRooms();
        });
    });

    if (proceedStep3Btn) {
        proceedStep3Btn.disabled = roomsList.length === 0;
        proceedStep3Btn.classList.toggle('enabled', roomsList.length > 0);
    }
}

addRoomBtn.onclick = e => {
    e.preventDefault();
    if (!buildingSelect.value || !roomNumber.value || !roomCapacity.value) {
        alert('Please fill in all fields (Building, Room Number, Capacity)');
        return;
    }
    
    // Check for duplicate building + room combination
    const isDuplicate = roomsList.some(r => 
        r.building === buildingSelect.value && r.room_number === roomNumber.value
    );
    
    if (isDuplicate) {
        alert(`Error: Room "${roomNumber.value}" in "${buildingSelect.value}" already exists!\n\nEach room must have a unique building + room number combination.`);
        return;
    }
    
    // Check if building and room number are the same (user-friendly check)
    if (buildingSelect.value === roomNumber.value) {
        alert(`Error: Building name and Room number cannot be the same!\n\nPlease use different values.\nExample: Building="Main Building" and Room="303"`);
        return;
    }
    
    roomsList.push({
        building: buildingSelect.value,
        room_number: roomNumber.value,
        capacity: roomCapacity.value
    });
    buildingSelect.value = '';
    roomNumber.value = '';
    roomCapacity.value = '';
    renderRooms();
};

if (backStep3Btn) {
    backStep3Btn.onclick = e => {
        e.preventDefault();
        step3.classList.remove('active');
        step2.classList.add('active');
        step3Content.style.display = 'none';
        step2Content.style.display = 'block';
    };
}

if (proceedStep3Btn) {
    proceedStep3Btn.onclick = e => {
        e.preventDefault();
        fetch('/add_rooms/', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrftoken },
            body: JSON.stringify({ exam_id: examId, rooms: roomsList })
        })
        .then(r => r.json())
        .then(r => {
            if (r.status === 'success') {
                step3.classList.remove('active');
                step3.classList.add('completed');
                step4.classList.add('active');
                step3Content.style.display = 'none';
                step4Content.style.display = 'block';
                loadUploadedFiles();
            } else {
                // Display user-friendly error message from backend
                alert('❌ Error: ' + r.message);
                console.error('Room validation error:', r.message);
            }
        })
        .catch(err => {
            console.error('Error saving rooms:', err);
            alert('❌ Error: Failed to save rooms. ' + err.message);
        });
    };
}

// =============================
// STEP 4 - SELECT STUDENT DATA (Updated with merged student info)
// =============================
const filterYear = document.getElementById('filterYear');
const filterSemester = document.getElementById('filterSemester');
const filterDepartment = document.getElementById('filterDepartment');
const filterBtn = document.getElementById('filterBtn');
const filesTableBody = document.getElementById('filesTableBody');
const showAllBtn = document.getElementById('showAllBtn');
const backStep4Btn = document.getElementById('backStep4Btn');
const proceedStep4Btn = document.getElementById('proceedStep4Btn');

selectedFiles = [];

function loadUploadedFiles() {
    fetch('/get_uploaded_files/', { method: 'GET', headers: { 'X-CSRFToken': csrftoken } })
    .then(r => r.json())
    .then(data => {
        if (data.status === 'success') {
            allUploadedFiles = data.files;
            displayFiles(allUploadedFiles);
        } else {
            filesTableBody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:#999;padding:20px;">No files uploaded yet.</td></tr>';
        }
    })
    .catch(err => console.error(err));
}

function displayFiles(files) {
    if (!files.length) {
        filesTableBody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:#999;padding:20px;">No files found.</td></tr>';
        return;
    }

    filesTableBody.innerHTML = files.map(file => `
        <tr>
            <td>${file.file_name}</td>
            <td>Semester ${file.semester}</td>
            <td>${file.year}</td>
            <td>${file.department}</td>
            <td><input type="checkbox" class="file-checkbox" data-file-id="${file.id}" data-dept="${file.department}"></td>
        </tr>
    `).join('');

    document.querySelectorAll('.file-checkbox').forEach(cb => cb.addEventListener('change', onFileCheckboxChange));
}

function onFileCheckboxChange() {
    const checkbox = this;
    const fileId = checkbox.dataset.fileId;
    const dept = checkbox.dataset.dept;

    if (checkbox.checked) {
        // Just store file ID, backend will fetch students on Proceed
        selectedFiles.push({ id: fileId, department: dept });
        updateProceedStep4Btn();
    } else {
        selectedFiles = selectedFiles.filter(f => f.id !== parseInt(fileId));
        updateProceedStep4Btn();
    }
}

function updateProceedStep4Btn() {
    if (proceedStep4Btn) {
        proceedStep4Btn.disabled = selectedFiles.length === 0;
        proceedStep4Btn.classList.toggle('enabled', selectedFiles.length > 0);
    }
}

if (filterBtn) {
    filterBtn.onclick = e => {
        e.preventDefault();
        let filtered = allUploadedFiles;
        if (filterYear.value) filtered = filtered.filter(f => f.year == filterYear.value);
        if (filterSemester.value) filtered = filtered.filter(f => f.semester == filterSemester.value);
        if (filterDepartment.value) filtered = filtered.filter(f => f.department === filterDepartment.value);
        displayFiles(filtered);
    };
}

if (showAllBtn) {
    showAllBtn.onclick = e => {
        e.preventDefault();
        // Reset filters visually and show everything loaded from the server
        if (filterYear) filterYear.value = '';
        if (filterSemester) filterSemester.value = '';
        if (filterDepartment) filterDepartment.value = '';
        displayFiles(allUploadedFiles || []);
    };
}

if (backStep4Btn) {
    backStep4Btn.onclick = e => {
        e.preventDefault();
        step4.classList.remove('active');
        step3.classList.add('active');
        step4Content.style.display = 'none';
        step3Content.style.display = 'block';
    };
}

if (proceedStep4Btn) {
    proceedStep4Btn.onclick = e => {
        e.preventDefault();
        console.log('[STEP 4] Saving files and generating seating...');
        
        // VALIDATION 2: Check if all selected departments have student data
        const selectedDepts = departmentExams ? Object.keys(departmentExams).filter(d => selectedDepartments.includes(d)) : [];
        const deptWithData = selectedFiles.map(f => f.department);
        
        let missingDepts = [];
        selectedDepts.forEach(dept => {
            if (!deptWithData.includes(dept)) {
                missingDepts.push(dept);
            }
        });
        
        if (missingDepts.length > 0) {
            let errorMsg = 'MISSING STUDENT DATA\n\n';
            errorMsg += 'The following departments have exams but NO student data:\n\n';
            missingDepts.forEach(dept => {
                errorMsg += `${dept}\n`;
            });
            errorMsg += '\nPlease select student data files for these departments in the table above.';
            alert(errorMsg);
            return;
        }
        
        // Step 1: Save selected files
        fetch('/save_selected_files/', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrftoken },
            body: JSON.stringify({ exam_id: examId, selected_files: selectedFiles })
        })
        .then(r => {
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            return r.json();
        })
        .then(saveResult => {
            if (saveResult.status !== 'success') {
                alert('Error saving files: ' + saveResult.message);
                return;
            }
            
            console.log('[STEP 4] Student data saved. Total students:', saveResult.total_students);
            console.log('[STEP 5] Generating seating...');
            
            // Step 2: Generate seating
            return fetch('/generate_seating/', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrftoken },
                body: JSON.stringify({ exam_id: examId })
            });
        })
        .then(r => r.json())
        .then(genResult => {
            if (genResult.status !== 'success') {
                alert(genResult.message);
                return;
            }
            
            console.log('[STEP 5] Seating generated successfully');
            console.log('Rooms:', genResult.rooms);
            
            // Store seating data for lock feature
            currentSeatingData = genResult.rooms;
            // Also expose on window so pattern modal can read it even across async flows
            window.currentSeatingData = currentSeatingData;
            
            // Move to Step 5 and display
            step4.classList.remove('active');
            step4.classList.add('completed');
            step5.classList.add('active');
            step4Content.style.display = 'none';
            step5Content.style.display = 'block';
            
            // Display seating results
            renderSeatGrid(genResult.rooms);
            
            // Enable both buttons
            document.getElementById('regenStep5Btn').disabled = false;
            document.getElementById('lockStep5Btn').disabled = false;
        })
        .catch(err => {
            console.error('Error:', err);
            alert('Error: ' + err.message);
        });
    };
}

// =============================
// STEP 5 - SEATING BUTTONS
// =============================
const roomSection = document.getElementById('roomSection');
const regenStep5Btn = document.getElementById('regenStep5Btn');
const lockStep5Btn = document.getElementById('lockStep5Btn');

// Regenerate Seating Button Handler — simplified (random only)
if (regenStep5Btn) {
    regenStep5Btn.onclick = e => {
        e.preventDefault();
        // Show confirmation modal
        const confirmModal = document.getElementById('regenConfirmModal');
        if (!confirmModal) return alert('Confirmation modal not found');
        confirmModal.style.display = 'flex';
    };

    // Regen confirmation modal handlers
    const confirmModal = document.getElementById('regenConfirmModal');
    if (confirmModal) {
        document.getElementById('cancelRegenBtn').addEventListener('click', () => {
            confirmModal.style.display = 'none';
        });
        
        document.getElementById('confirmRegenBtn').addEventListener('click', () => {
            confirmModal.style.display = 'none';
            roomSection.innerHTML = '<p style="text-align:center; padding:20px;">Regenerating seating...</p>';
            
            // Call generate_seating with random (no column_map)
            fetch('/generate_seating/', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrftoken },
                body: JSON.stringify({ exam_id: examId })
            })
            .then(r => r.json())
            .then(genResult => {
                if (genResult.status !== 'success') {
                    alert(genResult.message || 'Failed to generate seating');
                    renderSeatGrid([]);
                    return;
                }
                currentSeatingData = genResult.rooms;
                window.currentSeatingData = currentSeatingData;
                renderSeatGrid(genResult.rooms);
                document.getElementById('lockStep5Btn').disabled = false;
                document.getElementById('regenStep5Btn').disabled = false;
                alert('Seating regenerated successfully');
            })
            .catch(err => { 
                console.error(err); 
                alert('Error: '+err.message); 
                renderSeatGrid([]); 
            });
        });
    }
}

// Lock Seating Button Handler
if (lockStep5Btn) {
    lockStep5Btn.onclick = e => {
        e.preventDefault();
        console.log('[LOCK SEATING] Saving seating to database...');
        
        // Check if we have seating data
        if (!currentSeatingData) {
            alert('No seating data. Please generate seating first.');
            return;
        }
        
        // Send seating_data to backend
        fetch('/lock_seating/', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrftoken },
            body: JSON.stringify({ 
                exam_id: examId,
                seating_data: currentSeatingData
            })
        })
        .then(r => r.json())
        .then(lockResult => {
            if (lockResult.status !== 'success') {
                alert(lockResult.message);
                return;
            }
            
            console.log('[LOCK SEATING] Seating saved successfully');
            alert(lockResult.message);
            
            // Disable both buttons after locking
            regenStep5Btn.disabled = true;
            lockStep5Btn.disabled = true;
            
            // Move to Step 6
            step5.classList.remove('active');
            step5.classList.add('completed');
            step6.classList.add('active');
            step5Content.style.display = 'none';
            step6Content.style.display = 'block';
            
            // Load exam summary for Step 6
            loadExamSummary();
        })
        .catch(err => {
            console.error('Error:', err);
            alert('Error: ' + err.message);
        });
    };
}

// =============================
// STEP 6 - LOAD EXAM SUMMARY
// =============================
function loadExamSummary() {
    console.log('[STEP 6] Loading exam summary for exam ID:', examId);
    
    if (!examId) {
        console.error('[STEP 6] No exam ID provided');
        alert('Error: No exam ID found');
        return;
    }
    
    fetch(`/get_exam_summary/?exam_id=${examId}`, {
        method: 'GET',
        headers: { 'X-CSRFToken': csrftoken }
    })
    .then(r => {
        console.log('[STEP 6] Response status:', r.status);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
    })
    .then(data => {
        console.log('[STEP 6] Data received:', data);
        if (data.status === 'error') {
            alert('Error: ' + data.message);
            return;
        }
        populateSummary(data);
    })
    .catch(err => {
        console.error('[STEP 6] Error:', err);
        alert('Failed to load summary: ' + err.message);
    });
}

function populateSummary(data) {
    console.log('[STEP 6] Populating summary data');
    
    // Exam details
    document.getElementById('summaryExamName').textContent = data.exam.name || '-';
    document.getElementById('summaryStartDate').textContent = data.exam.start_date || '-';
    document.getElementById('summaryEndDate').textContent = data.exam.end_date || '-';
    
    // Departments
    const deptBody = document.getElementById('summaryDepartmentsBody');
    if (data.departments && data.departments.length > 0) {
        deptBody.innerHTML = data.departments.map(d => `
            <tr>
                <td>${d.department}</td>
                <td>${d.exam_name}</td>
                <td>${d.paper_code}</td>
                <td>${d.exam_date}</td>
                <td>${d.session}</td>
                <td>${d.start_time || '-'}</td>
                <td>${d.end_time || '-'}</td>
            </tr>
        `).join('');
    } else {
        deptBody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:#999;">No departments added</td></tr>';
    }
    
    // Student files
    const filesBody = document.getElementById('summaryFilesBody');
    if (data.student_files && data.student_files.length > 0) {
        filesBody.innerHTML = data.student_files.map(f => `
            <tr>
                <td>${f.file_name}</td>
                <td>${f.year}</td>
                <td>${f.semester}</td>
                <td>${f.department}</td>
                <td><span class="badge">${f.student_count}</span></td>
            </tr>
        `).join('');
    } else {
        filesBody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:#999;">No student files selected</td></tr>';
    }
    
    // Rooms
    const roomsBody = document.getElementById('summaryRoomsBody');
    if (data.rooms && data.rooms.length > 0) {
        roomsBody.innerHTML = data.rooms.map(r => `
            <tr>
                <td>${r.building}</td>
                <td>${r.room_number}</td>
                <td>${r.capacity}</td>
            </tr>
        `).join('');
    } else {
        roomsBody.innerHTML = '<tr><td colspan="3" style="text-align:center;color:#999;">No rooms configured</td></tr>';
    }
    
    // Seating summary
    document.getElementById('totalStudentsAllocated').textContent = data.total_students || 0;
    document.getElementById('totalSeatsAllocated').textContent = data.total_seats_allocated || 0;
    
    // Seating details
    const seatingPreview = document.getElementById('seatingPreview');
    if (data.seating && data.seating.length > 0) {
        const byRoom = {};
        data.seating.forEach(seat => {
            const key = `${seat.room_building}-${seat.room_number}`;
            if (!byRoom[key]) byRoom[key] = [];
            byRoom[key].push(seat);
        });
        
        let html = '';
        (data.rooms || []).forEach(room => {
            const key = `${room.building}-${room.room_number}`;
            const seats = byRoom[key] || [];
            
            html += `
                <div style="margin-bottom: 15px; border: 1px solid #ddd; padding: 10px; border-radius: 5px;">
                    <h4>${room.building} - Room ${room.room_number} (${seats.length} seats)</h4>
                    <table style="width:100%; font-size: 12px; border-collapse: collapse;">
                        <thead>
                            <tr style="background: #007bcd; color: white;">
                                <th style="padding: 5px; border: 1px solid #ddd;">Reg No</th>
                                <th style="padding: 5px; border: 1px solid #ddd;">Dept</th>
                                <th style="padding: 5px; border: 1px solid #ddd;">Seat</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${seats.map(s => `
                                <tr>
                                    <td style="padding: 5px; border: 1px solid #ddd;">${s.registration_number}</td>
                                    <td style="padding: 5px; border: 1px solid #ddd;">${s.department}</td>
                                    <td style="padding: 5px; border: 1px solid #ddd;"><strong>${s.seat_code}</strong></td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            `;
        });
        seatingPreview.innerHTML = html;
    } else {
        seatingPreview.innerHTML = '<p style="text-align:center;color:#999;">No seating allocated</p>';
    }
    
    // QR Code details
    // QR Code details (for reference only)
    const examNameQR = document.getElementById('examNameQR');
    const examDateQR = document.getElementById('examDateQR');
    const examSessionQR = document.getElementById('examSessionQR');
    const totalRoomsQR = document.getElementById('totalRoomsQR');
    
    if (examNameQR) examNameQR.textContent = data.exam.name || '-';
    if (examDateQR) examDateQR.textContent = data.exam.start_date && data.exam.end_date 
        ? `${data.exam.start_date} to ${data.exam.end_date}` 
        : '-';
    if (examSessionQR) examSessionQR.textContent = 'First Half';
    if (totalRoomsQR) totalRoomsQR.textContent = (data.rooms || []).length;
    
    // ✅ Generate UNIVERSAL QR code (same for all exams - no exam_id needed)
    console.log('[STEP 6] Generating UNIVERSAL QR code (no exam_id)');
    const backendQrUrl = `${window.location.origin}/generate_qr/?type=student_portal`;
    const qrImg = document.getElementById('qrPreview');
    if (qrImg) {
        qrImg.src = backendQrUrl;
        qrImg.alt = `Universal QR Code for Student Portal`;
        qrImg.style.display = 'block';
        console.log('[STEP 6] Universal QR code set with backend URL:', backendQrUrl);
    } else {
        console.warn('[STEP 6] QR code image element not found');
    }
    
    console.log('[STEP 6] Summary populated successfully');
    
    // ✅ ENABLE COMPLETE SETUP BUTTON
    if (completeSetupBtn) {
        completeSetupBtn.disabled = false;
        completeSetupBtn.style.cursor = 'pointer';
        completeSetupBtn.style.opacity = '1';
        completeSetupBtn.classList.add('enabled');
        console.log('[STEP 6] ✓ Complete Setup button ENABLED!');
        
        // ✅ ATTACH CLICK HANDLER (Only once, when button is enabled)
        if (!completeSetupBtn._clickHandlerAttached) {
            completeSetupBtn._clickHandlerAttached = true;
            console.log('[STEP 6] Click handler anchored to confirmation flow (no direct attachment to avoid bypassing confirmation)');
            // NOTE: Do NOT attach `handleCompleteSetupClick` directly. The authoritative click handler
            // is defined on `completeSetupBtn.onclick` earlier which first shows confirmation.
        }
    }
}

function renderSeatGrid(rooms) {
    roomSection.innerHTML = '';
    
    if (!rooms || rooms.length === 0) {
        roomSection.innerHTML = '<p>No seating data available</p>';
        return;
    }
    
    rooms.forEach(room => {
        // Create room container
        const roomDiv = document.createElement('div');
        roomDiv.className = 'room-container';
        
        // Room header
        const header = document.createElement('div');
        header.className = 'room-header';
        header.innerHTML = `<strong>${room.building} - ${room.room_number}</strong><span>Capacity: ${room.capacity} seats</span>`;
        roomDiv.appendChild(header);

        // Department exams info
        if (room.departments && room.departments.length > 0) {
            const deptDiv = document.createElement('div');
            deptDiv.className = 'dept-info';
            
            // Get unique exam info for each department
            const deptExamMap = {};
            if (room.seats && room.seats.length > 0) {
                room.seats.forEach(seat => {
                    if (!deptExamMap[seat.department]) {
                        deptExamMap[seat.department] = {
                            exam_name: seat.exam_name || 'N/A',
                            exam_date: seat.exam_date || 'N/A',
                            session: seat.session || 'N/A',
                            start_time: seat.start_time || 'N/A',
                            end_time: seat.end_time || 'N/A'
                        };
                    }
                });
            }
            
            let deptHtml = '<strong>Departments in this room:</strong><br>';
            room.departments.forEach(dept => {
                const examInfo = deptExamMap[dept] || {exam_name: 'N/A', exam_date: 'N/A', session: 'N/A', start_time: 'N/A', end_time: 'N/A'};
                deptHtml += `<strong>${dept}</strong> - ${examInfo.exam_name} (${examInfo.exam_date}, ${examInfo.session})<br>`;
                deptHtml += `&nbsp;&nbsp;Timing: ${examInfo.start_time} - ${examInfo.end_time}<br>`;
            });
            deptDiv.innerHTML = deptHtml;
            roomDiv.appendChild(deptDiv);
        }
        
        // Seat grid (5 columns × dynamic rows based on room capacity)
        const grid = document.createElement('div');
        grid.className = 'seat-grid';

        const cols = [1, 2, 3, 4, 5];
        // Compute number of rows needed from capacity (ceil(capacity / 5))
        const capacity = parseInt(room.capacity, 10) || 0;
        const rowsNeeded = capacity > 0 ? Math.ceil(capacity / 5) : 0;
        // Generate row letters A, B, C... up to rowsNeeded
        const rows = [];
        for (let i = 0; i < rowsNeeded; i++) rows.push(String.fromCharCode(65 + i));

        if (rows.length === 0) {
            grid.innerHTML = '<div style="color:#666; padding:10px;">No seats (capacity set to 0)</div>';
        } else {
            rows.forEach((row, rowIdx) => {
                const rowDiv = document.createElement('div');
                rowDiv.className = 'seat-row';

                // For last row, only render the leftover columns up to capacity
                let colsToRender = cols;
                if (rowIdx === rows.length - 1) {
                    const filledBefore = (rows.length - 1) * 5;
                    const lastRowCols = Math.max(0, capacity - filledBefore);
                    colsToRender = cols.slice(0, lastRowCols);
                }

                colsToRender.forEach(col => {
                    const seatDiv = document.createElement('div');
                    seatDiv.className = 'seat';

                    const seat = room.seats.find(s => s.row === row && s.column === col);
                    if (seat) {
                        seatDiv.classList.add('allocated');
                        seatDiv.innerHTML = `<div class="seat-num">${row}${col}</div><div class="seat-info">${seat.registration}</div><div class="seat-dept">${seat.department}</div>`;
                    } else {
                        seatDiv.classList.add('empty');
                        seatDiv.innerHTML = `<div class="seat-num">${row}${col}</div><div class="seat-info">Empty</div>`;
                    }
                    rowDiv.appendChild(seatDiv);
                });

                grid.appendChild(rowDiv);
            });
        }
        
        roomDiv.appendChild(grid);
        roomSection.appendChild(roomDiv);
    });
}

if (backStep5Btn) {
    backStep5Btn.onclick = e => {
        e.preventDefault();
        step5.classList.remove('active');
        step4.classList.add('active');
    };
}

if (lockStep5Btn) {
    lockStep5Btn.onclick = e => {
        e.preventDefault();
        fetch('/lock_seating/', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrftoken },
            body: JSON.stringify({ exam_id: examId })
        })
        .then(r => r.json())
        .then(() => {
            step5.classList.add('completed');
            step5.classList.remove('active');
            step6.classList.add('active');
            step5Content.style.display = 'none';
            step6Content.style.display = 'block';
            populateQRDetails();
        });
    };
}

// Regenerate Seating Button Handler
// =============================
// COMPLETE SETUP BUTTON HANDLER (Defined as separate function)
// =============================
function handleCompleteSetupClick(e) {
    e.preventDefault();
    
    console.log('[COMPLETE SETUP] Button clicked for exam ID:', examId);
    
    if (!examId) {
        alert('❌ Error: No exam ID found');
        return;
    }
    
    // Disable button and show loading state
    completeSetupBtn.disabled = true;
    const originalText = completeSetupBtn.textContent;
    completeSetupBtn.textContent = '⏳ Processing...';
    
    console.log('[COMPLETE SETUP] Sending POST request to /complete-exam-setup/');
    
    // Mark exam as completed (no more deletion on refresh)
    fetch('/complete-exam-setup/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrftoken },
        body: JSON.stringify({ exam_id: examId })
    })
    .then(r => {
        console.log('[COMPLETE SETUP] Response status:', r.status);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
    })
    .then(r => {
        console.log('[COMPLETE SETUP] Response:', r);
        if (r.status === 'success') {
            alert('✅ Exam setup completed successfully!');
            console.log('[COMPLETE SETUP] Exam finalized with ID:', examId);
            // Redirect to dashboard
            setTimeout(() => {
                console.log('[COMPLETE SETUP] Redirecting to dashboard...');
                window.location.href = '/dashboard/';
            }, 500);
        } else {
            throw new Error(r.message || 'Unknown error');
        }
    })
    .catch(err => {
        console.error('[COMPLETE SETUP] Error:', err);
        alert('❌ Error completing exam setup: ' + err.message);
        // Re-enable button on error
        completeSetupBtn.disabled = false;
        completeSetupBtn.textContent = originalText;
        console.log('[COMPLETE SETUP] Button re-enabled after error');
    });
}

// =============================
// STEP 6 - QR DETAILS
// =============================
const examNameQR = document.getElementById('examNameQR');
const examDateQR = document.getElementById('examDateQR');
const totalRoomsQR = document.getElementById('totalRoomsQR');

function populateQRDetails() {
    examNameQR.textContent = examName.value;
    examDateQR.textContent = `${examStartDate.value} → ${examEndDate.value}`;
    totalRoomsQR.textContent = roomsList.length;
}

// ✅ COMPLETE SETUP HANDLER ATTACHED IN populateSummary() WHEN BUTTON IS ENABLED
