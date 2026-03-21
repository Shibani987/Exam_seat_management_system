function safeId(text) {
    return text
        .toLowerCase()
        .replace(/\s+/g, '-')
        .replace(/[^\w-]/g, '');
}


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
let scheduleFileName = null;  // name of the uploaded exam schedule file (optional)
let roomsFileName = null;     // name of the uploaded rooms file (optional)
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

function parse12HourTime(value) {
    if (!value) return null;

    // Accept values like "10:00 AM", "10:00AM", "10:00 am", or 24h values like "13:00", "09:30"
    const cleaned = String(value).trim();

    // 12-hour format with AM/PM
    let match = cleaned.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
    if (match) {
        const hour = parseInt(match[1], 10);
        const minute = match[2];
        const ampm = match[3].toUpperCase();
        if (hour < 1 || hour > 12) return null;
        return {
            hour: String(hour).padStart(2, '0'),
            minute,
            ampm
        };
    }

    // 24-hour format without AM/PM
    match = cleaned.match(/^(\d{1,2}):(\d{2})$/);
    if (match) {
        const hour24 = parseInt(match[1], 10);
        const minute = match[2];
        if (hour24 < 0 || hour24 > 23) return null;
        const ampm = hour24 >= 12 ? 'PM' : 'AM';
        const hour12 = hour24 % 12 || 12;
        return {
            hour: String(hour12).padStart(2, '0'),
            minute,
            ampm
        };
    }

    return null;
}

function normalizeSession(value) {
    if (!value) return '';
    const v = String(value).trim().toLowerCase();
    if (v === 'morning' || v === '1st half' || v === '1sthalf') return '1st Half';
    if (v === 'afternoon' || v === '2nd half' || v === '2ndhalf') return '2nd Half';
    // Fallback: keep original casing
    return String(value).trim();
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
// STEP 2 - DEPARTMENTS & EXAMS (Robust Version)
// =============================
const deptDivs = document.querySelectorAll('.department');
const examsContainer = document.getElementById('examsContainer');
const examScheduleFileInput = document.getElementById('examScheduleFileInput');
const uploadExamScheduleBtn = document.getElementById('uploadExamScheduleBtn');
const uploadScheduleStatus = document.getElementById('uploadScheduleStatus');
const backBtn = document.getElementById('backBtn');
const nextBtn = document.getElementById('nextBtn');
let departmentExams = {};

if (nextBtn) {
    nextBtn.addEventListener('click', function(e) {
        e.preventDefault();
        
        // Submit departments BEFORE moving to step 3
        console.log('[STEP 2] Next button clicked - submitting departments...');
        console.log('[STEP 2] Selected departments:', selectedDepartments);
        console.log('[STEP 2] Department exams:', departmentExams);
        
        const payload = selectedDepartments.map(dept => ({ department: dept, exams: departmentExams[dept] }));
        
        fetch('/add_departments/', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrftoken },
            body: JSON.stringify({ exam_id: examId, departments: payload, schedule_file_name: scheduleFileName })
        })
        .then(r => {
            console.log('[STEP 2] Response status:', r.status);
            return r.json();
        })
        .then(r => {
            console.log('[STEP 2] Response data:', r);
            if (r.status === 'success') {
                console.log('[STEP 2] ✓ Departments created successfully');
                step2.classList.remove('active');
                step2.classList.add('completed');
                step3.classList.add('active');
                step2Content.style.display = 'none';
                step3Content.style.display = 'block';
                renderRooms();
            } else {
                console.error('[STEP 2] ✗ Error:', r.message);
                alert('❌ Error adding departments:\n' + r.message);
            }
        })
        .catch(err => {
            console.error('[STEP 2] Fetch error:', err);
            alert('❌ Error submitting departments:\n' + err.message);
        });
    });
}
if (nextBtn) nextBtn.disabled = true;

deptDivs.forEach(dept => {
    dept.addEventListener('click', () => {
        const name = dept.dataset.name;
        const deptId = safeId(name);

        dept.classList.toggle('selected');

        if (selectedDepartments.includes(name)) {
            selectedDepartments = selectedDepartments.filter(d => d !== name);
            delete departmentExams[name];
        } else {
            selectedDepartments.push(name);
            departmentExams[name] = [{
                name: '', code: '', date: '', session: '',
                start_time: '', end_time: '',
                start_hour: '12', start_minute: '00', start_ampm: 'AM',
                end_hour: '12', end_minute: '00', end_ampm: 'AM',
                semester: ''
            }];
        }

        renderExamInputs();

        // Focus first exam input safely
        setTimeout(() => {
            const firstInput = document.querySelector(`#exams-${deptId} .exam-name`);
            if (firstInput) firstInput.focus();
        }, 0);
    });
});

function updateDepartmentSelectionUI() {
    deptDivs.forEach(d => {
        const name = d.dataset.name;
        if (selectedDepartments.includes(name)) {
            d.classList.add('selected');
        } else {
            d.classList.remove('selected');
        }
    });
}

function parseCsv(text) {
    // Remove BOM if present
    if (text.charCodeAt(0) === 0xFEFF) {
        text = text.slice(1);
    }

    // Detect delimiter: count commas, tabs, and semicolons in first line
    const firstLine = text.split('\n')[0] || '';
    const commaCount = (firstLine.match(/,/g) || []).length;
    const tabCount = (firstLine.match(/\t/g) || []).length;
    const semicolonCount = (firstLine.match(/;/g) || []).length;
    const maxCount = Math.max(commaCount, tabCount, semicolonCount);
    let delimiter = ',';
    if (tabCount === maxCount) delimiter = '\t';
    else if (semicolonCount === maxCount) delimiter = ';';

    const rows = [];
    let current = '';
    let inQuotes = false;
    let row = [];

    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (ch === '"') {
            if (inQuotes && i + 1 < text.length && text[i + 1] === '"') {
                // Escaped quote
                current += '"';
                i++;
            } else {
                inQuotes = !inQuotes;
            }
        } else if (ch === delimiter && !inQuotes) {
            row.push(current);
            current = '';
        } else if ((ch === '\n' || ch === '\r') && !inQuotes) {
            if (ch === '\r' && i + 1 < text.length && text[i + 1] === '\n') {
                i++; // skip \n in CRLF
            }
            row.push(current);
            rows.push(row);
            row = [];
            current = '';
        } else {
            current += ch;
        }
    }

    if (current !== '' || row.length > 0) {
        row.push(current);
        rows.push(row);
    }

    return rows;
}

function loadExamScheduleFromCsv(rows) {
    if (!rows || rows.length < 2) {
        throw new Error('File must contain a header row and at least one data row.');
    }

    const headerRow = rows[0].map(h => (h || '').toString().trim().toLowerCase());
    const findHeaderIndex = candidates => {
        for (const candidate of candidates) {
            const idx = headerRow.indexOf(candidate);
            if (idx !== -1) return idx;
        }
        return -1;
    };

    const deptIdx = findHeaderIndex(['dept name', 'department', 'dept']);
    const examNameIdx = findHeaderIndex(['exam name', 'exam', 'course']);
    const paperCodeIdx = findHeaderIndex(['paper code', 'code']);
    const dateIdx = findHeaderIndex(['date']);
    const sessionIdx = findHeaderIndex(['session']);
    const startTimeIdx = findHeaderIndex(['start time', 'starttime', 'start']);
    const endTimeIdx = findHeaderIndex(['end time', 'endtime', 'end']);
    const semesterIdx = findHeaderIndex(['semester', 'sem']);

    const missing = [];
    if (deptIdx === -1) missing.push('Dept Name');
    if (examNameIdx === -1) missing.push('Exam Name');
    if (paperCodeIdx === -1) missing.push('Paper Code');
    if (dateIdx === -1) missing.push('Date');
    if (sessionIdx === -1) missing.push('Session');
    if (startTimeIdx === -1) missing.push('Start Time');
    if (endTimeIdx === -1) missing.push('End Time');
    if (missing.length) {
        throw new Error('Missing required column(s): ' + missing.join(', ') + '. Found headers: ' + rows[0].join(', '));
    }

    const newDepartments = {};
    const errors = [];

    function normalizeDepartmentName(raw) {
        const val = (raw || '').trim();
        if (!val) return '';
        const lower = val.toLowerCase();

        // Exact match for existing department items
        const existing = Array.from(deptDivs).map(d => d.dataset.name);
        const exact = existing.find(d => d.toLowerCase() === lower);
        if (exact) return exact;

        // Try substring match (e.g. "BCA" -> "Bachelor of Computer Applications (BCA)")
        const substring = existing.find(d => d.toLowerCase().includes(lower));
        if (substring) return substring;

        // As a fallback, use original value
        return val;
    }

    function excelSerialToDate(serial) {
        // Excel serial date to JS Date
        const utc_days = Math.floor(serial - 25569);
        const utc_value = utc_days * 86400;
        const date = new Date(utc_value * 1000);
        const fractional = serial - Math.floor(serial);
        let totalSeconds = Math.round(86400 * fractional);
        const seconds = totalSeconds % 60;
        totalSeconds = (totalSeconds - seconds) / 60;
        const minutes = totalSeconds % 60;
        const hours = (totalSeconds - minutes) / 60;
        date.setHours(hours, minutes, seconds, 0);
        return date;
    }

    function formatDateYYYYMMDD(d) {
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    function normalizeTextValue(value) {
        if (value == null || value === '') return '';
        if (value instanceof Date) {
            return formatDateYYYYMMDD(value);
        }
        return String(value).trim();
    }

    function normalizeDateValue(value) {
        if (value == null || value === '') return '';
        if (value instanceof Date) {
            return formatDateYYYYMMDD(value);
        }
        if (typeof value === 'number') {
            const d = excelSerialToDate(value);
            return formatDateYYYYMMDD(d);
        }
        const s = normalizeTextValue(value);
        // Accept dd-mm-yyyy or dd/mm/yyyy
        const m = s.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);
        if (m) {
            const [_, d, mth, y] = m;
            return `${y}-${String(mth).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        }
        return s;
    }

    function normalizeTimeValue(value) {
        if (value == null || value === '') return '';
        if (value instanceof Date) {
            const hours = value.getHours();
            const minutes = value.getMinutes();
            return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
        }
        if (typeof value === 'number') {
            // Excel time is fraction of a day
            const totalSeconds = Math.round(86400 * value);
            const hours = Math.floor(totalSeconds / 3600);
            const minutes = Math.floor((totalSeconds % 3600) / 60);
            return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
        }
        return String(value).trim();
    }

    rows.slice(1).forEach((row, rowIndex) => {
        let dept = (row[deptIdx] || '').trim();
        dept = normalizeDepartmentName(dept);
        if (!dept) return; // skip blank lines

        const examName = (row[examNameIdx] || '').trim();
        const paperCode = (row[paperCodeIdx] || '').trim();
        const date = normalizeDateValue(row[dateIdx]);
        const session = normalizeSession(row[sessionIdx] || '');
        const startTimeRaw = normalizeTimeValue(row[startTimeIdx]);
        const endTimeRaw = normalizeTimeValue(row[endTimeIdx]);
        const semester = normalizeTextValue(row[semesterIdx]);

        const startParts = parse12HourTime(startTimeRaw);
        const endParts = parse12HourTime(endTimeRaw);

        if (!examName || !paperCode || !date || !session || !startParts || !endParts) {
            errors.push(`Row ${rowIndex + 2} is missing required data or has invalid time format.`);
            return;
        }

        const startTime24 = convertTo24HourFormat(startParts.hour, startParts.minute, startParts.ampm);
        const endTime24 = convertTo24HourFormat(endParts.hour, endParts.minute, endParts.ampm);

        if (!newDepartments[dept]) newDepartments[dept] = [];
        newDepartments[dept].push({
            name: examName,
            code: paperCode,
            date,
            session,
            start_time: startTime24,
            end_time: endTime24,
            start_hour: startParts.hour,
            start_minute: startParts.minute,
            start_ampm: startParts.ampm,
            end_hour: endParts.hour,
            end_minute: endParts.minute,
            end_ampm: endParts.ampm,
            semester: semester
        });
    });

    return { departments: newDepartments, errors };
}

if (uploadExamScheduleBtn) {
    uploadExamScheduleBtn.addEventListener('click', e => {
        e.preventDefault();
        uploadScheduleStatus.textContent = '';

        const file = examScheduleFileInput?.files?.[0];
        if (!file) {
            uploadScheduleStatus.style.color = '#c62828';
            uploadScheduleStatus.textContent = 'Please select a CSV or XLSX file to upload.';
            return;
        }

        // remember file name for later persistence
        scheduleFileName = file.name;

        const reader = new FileReader();
        reader.onload = () => {
            try {
                let rows;
                if (file.name.toLowerCase().endsWith('.xlsx')) {
                    const workbook = XLSX.read(reader.result, { type: 'array' });
                    const sheetName = workbook.SheetNames[0];
                    const worksheet = workbook.Sheets[sheetName];
                    rows = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
                } else {
                    // CSV
                    const text = reader.result;
                    rows = parseCsv(text);
                }
                const payload = loadExamScheduleFromCsv(rows);
                selectedDepartments = Object.keys(payload.departments);
                departmentExams = payload.departments;

                updateDepartmentSelectionUI();
                renderExamInputs();

                // Hide manual department selection once schedule is loaded
                const deptInstructions = document.getElementById('departmentInstructions');
                const deptContainer = document.getElementById('departmentContainer');
                if (deptInstructions) deptInstructions.style.display = 'none';
                if (deptContainer) deptContainer.style.display = 'none';

                const deptCount = selectedDepartments.length;
                const examCount = Object.values(departmentExams).reduce((sum, exs) => sum + exs.length, 0);
                uploadScheduleStatus.style.color = '#2e7d32';
                uploadScheduleStatus.textContent = `Loaded ${examCount} exam(s) across ${deptCount} department(s) from '${scheduleFileName}'.`;

                if (payload.errors.length) {
                    uploadScheduleStatus.style.color = '#c62828';
                    uploadScheduleStatus.textContent += ' Some rows were skipped: ' + payload.errors.join(' ');
                }
            } catch (err) {
                console.error('Failed to parse schedule file:', err);
                uploadScheduleStatus.style.color = '#c62828';
                uploadScheduleStatus.textContent = 'Failed to parse file: ' + err.message;
            }
        };
        reader.onerror = () => {
            uploadScheduleStatus.style.color = '#c62828';
            uploadScheduleStatus.textContent = 'Failed to read file.';
        };
        if (file.name.toLowerCase().endsWith('.xlsx')) {
            reader.readAsArrayBuffer(file);
        } else {
            reader.readAsText(file);
        }
    });
}

function renderExamInputs() {
    if (!examsContainer) return;

    examsContainer.innerHTML = '';

    selectedDepartments.forEach(dept => {
        const deptSection = document.createElement('div');
        deptSection.className = 'dept-exam-section';
        deptSection.innerHTML = `
            <h3>${dept}</h3>
            <div class="exams-list" id="exams-${safeId(dept)}"></div>
            <button class="add-exam-btn" data-dept="${dept}">+ Add Exam for ${dept}</button>
        `;
        examsContainer.appendChild(deptSection);
        renderDeptExams(dept);
    });

    document.querySelectorAll('.add-exam-btn').forEach(btn => {
        btn.addEventListener('click', e => {
            e.preventDefault();
            const dept = btn.dataset.dept;
            departmentExams[dept].push({
                name: '', code: '', date: '', session: '',
                start_time: '', end_time: '',
                start_hour: '12', start_minute: '00', start_ampm: 'AM',
                end_hour: '12', end_minute: '00', end_ampm: 'AM',
                semester: ''
            });
            renderDeptExams(dept);
        });
    });

    checkDeptInputs();
}

function isExamComplete(exam) {
    return Boolean(exam && exam.name && exam.code && exam.date && exam.session && exam.start_time && exam.end_time);
}

function updateDeptWarning(dept) {
    const exams = departmentExams[dept] || [];
    const examsListEl = document.getElementById(`exams-${safeId(dept)}`);
    if (!examsListEl) return;

    const warningId = `exam-warning-${safeId(dept)}`;
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
            warnEl.textContent = 'Please add at least one exam for this department.';
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
    const examsList = document.getElementById(`exams-${safeId(dept)}`);
    if (!examsList) return;

    examsList.innerHTML = '';

    const exams = departmentExams[dept] || [];
    if (exams.length === 0) {
        examsList.innerHTML = '<p style="color: #999; font-size: 0.9rem;">No exams added yet</p>';
        const existingWarn = document.getElementById(`exam-warning-${safeId(dept)}`);
        if (existingWarn) existingWarn.remove();
        return;
    }

    exams.forEach((exam, idx) => {
        const startTime12hr = exam.start_hour ? { hour: exam.start_hour, minute: exam.start_minute, ampm: exam.start_ampm } : convertTo12HourFormat(exam.start_time);
        const endTime12hr = exam.end_hour ? { hour: exam.end_hour, minute: exam.end_minute, ampm: exam.end_ampm } : convertTo12HourFormat(exam.end_time);

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
                    <option value="1st Half" ${exam.session==='1st Half'?'selected':''}>1st Half</option>
                    <option value="2nd Half" ${exam.session==='2nd Half'?'selected':''}>2nd Half</option>
                </select>
                <input type="text" class="exam-semester" data-dept="${dept}" data-idx="${idx}" placeholder="Semester" value="${exam.semester || ''}">
            </div>
            <div class="exam-row">
                <div class="time-input-group">
                    <label>Start Time</label>
                    <div class="time-selectors">
                        <select class="exam-start_hour" data-dept="${dept}" data-idx="${idx}">${generateHourOptions(exam.start_hour)}</select>
                        <span>:</span>
                        <select class="exam-start_minute" data-dept="${dept}" data-idx="${idx}">${generateMinuteOptions(exam.start_minute)}</select>
                        <select class="exam-start_ampm" data-dept="${dept}" data-idx="${idx}">
                            <option value="AM" ${exam.start_ampm==='AM'?'selected':''}>AM</option>
                            <option value="PM" ${exam.start_ampm==='PM'?'selected':''}>PM</option>
                        </select>
                    </div>
                </div>
                <div class="time-input-group">
                    <label>End Time</label>
                    <div class="time-selectors">
                        <select class="exam-end_hour" data-dept="${dept}" data-idx="${idx}">${generateHourOptions(exam.end_hour)}</select>
                        <span>:</span>
                        <select class="exam-end_minute" data-dept="${dept}" data-idx="${idx}">${generateMinuteOptions(exam.end_minute)}</select>
                        <select class="exam-end_ampm" data-dept="${dept}" data-idx="${idx}">
                            <option value="AM" ${exam.end_ampm==='AM'?'selected':''}>AM</option>
                            <option value="PM" ${exam.end_ampm==='PM'?'selected':''}>PM</option>
                        </select>
                    </div>
                </div>
                <button class="remove-exam-btn" data-dept="${dept}" data-idx="${idx}">Remove</button>
            </div>
        `;
        examsList.appendChild(examDiv);
    });

    // Event listeners safely
    examsList.querySelectorAll('.exam-name, .exam-code, .exam-date, .exam-session, .exam-semester, .exam-start_hour, .exam-start_minute, .exam-start_ampm, .exam-end_hour, .exam-end_minute, .exam-end_ampm').forEach(input => {
        input.addEventListener('change', e => {
            const dept = e.target.dataset.dept;
            const idx = e.target.dataset.idx;
            const className = e.target.className.split(' ')[0];

            if (!departmentExams[dept] || !departmentExams[dept][idx]) return;

            if (className.includes('start_hour') || className.includes('start_minute') || className.includes('start_ampm')) {
                const hour = parseInt(examsList.querySelector(`select.exam-start_hour[data-dept="${dept}"][data-idx="${idx}"]`)?.value || 12);
                const minute = examsList.querySelector(`select.exam-start_minute[data-dept="${dept}"][data-idx="${idx}"]`)?.value || '00';
                const ampm = examsList.querySelector(`select.exam-start_ampm[data-dept="${dept}"][data-idx="${idx}"]`)?.value || 'AM';
                departmentExams[dept][idx]['start_time'] = convertTo24HourFormat(hour, minute, ampm);
                departmentExams[dept][idx]['start_hour'] = hour;
                departmentExams[dept][idx]['start_minute'] = minute;
                departmentExams[dept][idx]['start_ampm'] = ampm;
            } else if (className.includes('end_hour') || className.includes('end_minute') || className.includes('end_ampm')) {
                const hour = parseInt(examsList.querySelector(`select.exam-end_hour[data-dept="${dept}"][data-idx="${idx}"]`)?.value || 12);
                const minute = examsList.querySelector(`select.exam-end_minute[data-dept="${dept}"][data-idx="${idx}"]`)?.value || '00';
                const ampm = examsList.querySelector(`select.exam-end_ampm[data-dept="${dept}"][data-idx="${idx}"]`)?.value || 'AM';
                departmentExams[dept][idx]['end_time'] = convertTo24HourFormat(hour, minute, ampm);
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
            if (departmentExams[dept]) {
                departmentExams[dept].splice(idx, 1);
                renderDeptExams(dept);
            }
        });
    });

    try { updateDeptWarning(dept); } catch (err) { console.warn('updateDeptWarning failed:', err); }
}

function checkDeptInputs() {
    const hasDept = selectedDepartments.length >= 1;
    let allValid = hasDept;

    selectedDepartments.forEach(dept => {
        const exams = departmentExams[dept] || [];
        const hasComplete = exams.some(isExamComplete);
        updateDeptWarning(dept);
        if (exams.length === 0 || !hasComplete) allValid = false;
    });

    if (nextBtn) {
        nextBtn.disabled = !allValid;
        nextBtn.classList.toggle('enabled', allValid);
    }
}

// =============================
// STEP 3 - ROOMS
// =============================
const roomFileInput = document.getElementById('roomFileInput');
const uploadRoomsBtn = document.getElementById('uploadRoomsBtn');
const uploadRoomsStatus = document.getElementById('uploadRoomsStatus');
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
    // Fixed building list - only used for room rendering after upload.
    return '<option value="">Select Building</option><option value="Main Building">Main Building</option><option value="CMS">CMS</option>';
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


if (uploadRoomsBtn) {
    uploadRoomsBtn.onclick = async e => {
        e.preventDefault();
        if (!roomFileInput || !roomFileInput.files || roomFileInput.files.length === 0) {
            alert('Please select a file to upload.');
            return;
        }
        if (!examId) {
            alert('Exam ID is missing. Please refresh the page.');
            return;
        }

        const file = roomFileInput.files[0];
        roomsFileName = file.name;
        const formData = new FormData();
        formData.append('file', file);
        formData.append('exam_id', examId);

        try {
            const resp = await fetch('/upload-rooms-file/', {
                method: 'POST',
                headers: {
                    'X-CSRFToken': csrftoken
                },
                body: formData
            });
            const data = await resp.json();
            if (data.status !== 'success') {
                if (uploadRoomsStatus) {
                    uploadRoomsStatus.style.color = '#c62828';
                    uploadRoomsStatus.textContent = 'Upload failed: ' + (data.message || 'Unknown error');
                } else {
                    alert('Upload failed: ' + (data.message || 'Unknown error'));
                }
                return;
            }

            roomsList = data.rooms || [];
            renderRooms();
            if (uploadRoomsStatus) {
                uploadRoomsStatus.style.color = '#2e7d32';
                uploadRoomsStatus.textContent = `Loaded ${roomsList.length} rooms from '${roomsFileName}'.`;
            }
        } catch (err) {
            console.error('Upload rooms file failed', err);
            if (uploadRoomsStatus) {
                uploadRoomsStatus.style.color = '#c62828';
                uploadRoomsStatus.textContent = 'Upload failed: ' + err.message;
            } else {
                alert('Upload failed: ' + err.message);
            }
        }
    };
}

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
            body: JSON.stringify({ exam_id: examId, rooms: roomsList, rooms_file_name: roomsFileName })
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
const filterFileName = document.getElementById('filterFileName');
const searchFileBtn = document.getElementById('searchFileBtn');
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
            filesTableBody.innerHTML = '<tr><td colspan="2" style="text-align:center;color:#999;padding:20px;">No files uploaded yet.</td></tr>';
        }
    })
    .catch(err => console.error(err));
}

function displayFiles(files) {
    if (!files.length) {
        filesTableBody.innerHTML = '<tr><td colspan="2" style="text-align:center;color:#999;padding:20px;">No files found.</td></tr>';
        return;
    }

    const selectedIds = new Set(selectedFiles.map(f => String(f.id)));

    filesTableBody.innerHTML = files.map(file => {
        const checked = selectedIds.has(String(file.id)) ? 'checked' : '';
        const dept = file.department || '';
        return `
        <tr>
            <td>${file.file_name}</td>
            <td><input type="checkbox" class="file-checkbox" ${checked} data-file-id="${file.id}" data-dept="${dept}"></td>
        </tr>
    `;
    }).join('');

    document.querySelectorAll('.file-checkbox').forEach(cb => cb.addEventListener('change', onFileCheckboxChange));
}

function onFileCheckboxChange() {
    const checkbox = this;
    const fileId = checkbox.dataset.fileId;
    const dept = checkbox.dataset.dept || '';

    if (checkbox.checked) {
        // Just store file ID, backend will fetch students on Proceed
        selectedFiles.push({ id: fileId, department: dept });
        updateProceedStep4Btn();
    } else {
        selectedFiles = selectedFiles.filter(f => String(f.id) !== String(fileId));
        updateProceedStep4Btn();
    }
}

function updateProceedStep4Btn() {
    if (proceedStep4Btn) {
        proceedStep4Btn.disabled = selectedFiles.length === 0;
        proceedStep4Btn.classList.toggle('enabled', selectedFiles.length > 0);
    }
}

if (searchFileBtn) {
    searchFileBtn.onclick = e => {
        e.preventDefault();
        const query = (filterFileName?.value || '').trim().toLowerCase();
        if (!query) {
            displayFiles(allUploadedFiles);
            return;
        }
        const filtered = (allUploadedFiles || []).filter(f => (f.file_name || '').toLowerCase().includes(query));
        displayFiles(filtered);
    };
}

if (showAllBtn) {
    showAllBtn.onclick = e => {
        e.preventDefault();
        // Reset search fields and show everything loaded from the server
        if (filterFileName) filterFileName.value = '';
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

        if (!examId) {
            alert('Error: exam_id is missing. Please refresh and try again.');
            return;
        }

        if (!Array.isArray(selectedFiles) || selectedFiles.length === 0) {
            alert('Please select at least one uploaded file before proceeding.');
            return;
        }

        const selectedFileIds = selectedFiles
            .map(f => {
                if (typeof f === 'number' || typeof f === 'string') return Number(f);
                if (f && (typeof f === 'object') && (f.id || f.file_id)) return Number(f.id || f.file_id);
                return null;
            })
            .filter(id => Number.isInteger(id) && id > 0);

        if (selectedFileIds.length === 0) {
            alert('No valid selected file IDs found. Please re-select files.');
            return;
        }

        fetch('/save_selected_files/', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrftoken },
            body: JSON.stringify({ exam_id: examId, selected_files: selectedFileIds })
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
            console.log('[STEP 5] genResult:', genResult);
            console.log('[STEP 5] genResult.rooms:', genResult.rooms);
            console.log('[STEP 5] genResult.rooms.length:', genResult.rooms?.length);
            
            if (!genResult.rooms || genResult.rooms.length === 0) {
                console.error('[STEP 5] ✗ NO ROOMS DATA! Cannot display seating');
                alert('Error: No rooms data returned from seating generation');
                return;
            }
            
            // Show first room structure for debugging
            if (genResult.rooms[0]) {
                console.log('[STEP 5] First room structure:', genResult.rooms[0]);
                if (genResult.rooms[0].seats && genResult.rooms[0].seats.length > 0) {
                    console.log('[STEP 5] First seat structure:', genResult.rooms[0].seats[0]);
                }
            }
            
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
            console.log('[STEP 5] Calling renderSeatGrid with rooms:', genResult.rooms);
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
    const summaryExamName = document.getElementById('summaryExamName');
    const summaryStartDate = document.getElementById('summaryStartDate');
    const summaryEndDate = document.getElementById('summaryEndDate');
    
    if (summaryExamName) summaryExamName.textContent = data.exam?.name || '-';
    if (summaryStartDate) summaryStartDate.textContent = data.exam?.start_date || '-';
    if (summaryEndDate) summaryEndDate.textContent = data.exam?.end_date || '-';

    const summaryScheduleFile = document.getElementById('summaryScheduleFile');
    const summaryRoomsFile = document.getElementById('summaryRoomsFile');
    if (summaryScheduleFile) summaryScheduleFile.textContent = data.exam?.schedule_file_name || scheduleFileName || '-';
    if (summaryRoomsFile) summaryRoomsFile.textContent = data.exam?.rooms_file_name || roomsFileName || '-';
    
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
                <td>${d.semester || '-'}</td>
                <td>${d.start_time || '-'}</td>
                <td>${d.end_time || '-'}</td>
            </tr>
        `).join('');
    } else {
        deptBody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:#999;">No departments added</td></tr>';
    }
    
    // Student files
    const filesBody = document.getElementById('summaryFilesBody');
    if (data.student_files && data.student_files.length > 0) {
        filesBody.innerHTML = data.student_files.map(f => `
            <tr>
                <td>${f.file_name}</td>
                <td><span class="badge">${f.student_count}</span></td>
            </tr>
        `).join('');
    } else {
        filesBody.innerHTML = '<tr><td colspan="2" style="text-align:center;color:#999;">No student files selected</td></tr>';
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
    const totalStudEl = document.getElementById('totalStudentsAllocated');
    const totalSeatsEl = document.getElementById('totalSeatsAllocated');
    
    if (totalStudEl) totalStudEl.textContent = data.total_students || 0;
    if (totalSeatsEl) totalSeatsEl.textContent = data.total_seats_allocated || 0;
    
    // Seating details - group seating by room
    const seatingPreview = document.getElementById('seatingPreview');
    if (seatingPreview) {
        // Get seating data (could be from generate_seating or get_exam_summary)
        const seatingList = data.seating || [];
        
        if (seatingList.length > 0) {
            // Group seating by room
            const byRoom = {};
            seatingList.forEach(seat => {
                const key = `${seat.room_building || 'Main'}-${seat.room_number || 'N/A'}`;
                if (!byRoom[key]) {
                    byRoom[key] = {
                        building: seat.room_building || 'Main',
                        room_number: seat.room_number || 'N/A',
                        seats: []
                    };
                }
                byRoom[key].seats.push(seat);
            });
            
            let html = '';
            Object.values(byRoom).forEach(room => {
                const count = room.seats.length;
                html += `
                    <div style="margin-bottom: 15px; border: 1px solid #ddd; padding: 10px; border-radius: 5px;">
                        <h4>${room.building} - Room ${room.room_number} (${count} seats)</h4>
                        <table style="width:100%; font-size: 12px; border-collapse: collapse;">
                            <thead>
                                <tr style="background: #007bcd; color: white;">
                                    <th style="padding: 5px; border: 1px solid #ddd;">Reg No</th>
                                    <th style="padding: 5px; border: 1px solid #ddd;">Dept</th>
                                    <th style="padding: 5px; border: 1px solid #ddd;">Seat</th>
                                    <th style="padding: 5px; border: 1px solid #ddd;">Exam</th>
                                    <th style="padding: 5px; border: 1px solid #ddd;">Date</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${room.seats.map(s => `
                                    <tr>
                                        <td style="padding: 5px; border: 1px solid #ddd;">${s.registration_number || s.registration || 'N/A'}</td>
                                        <td style="padding: 5px; border: 1px solid #ddd;">${s.department || 'N/A'}</td>
                                        <td style="padding: 5px; border: 1px solid #ddd;"><strong>${s.seat_code || s.seat || 'N/A'}</strong></td>
                                        <td style="padding: 5px; border: 1px solid #ddd;">${s.exam_name || 'N/A'}</td>
                                        <td style="padding: 5px; border: 1px solid #ddd;">${s.exam_date || 'N/A'}</td>
                                    </tr>
                                `).join('')}
                            </tbody>
                        </table>
                    </div>
                `;
            });
            
            seatingPreview.innerHTML = html;
        } else {
            seatingPreview.innerHTML = '<p style="text-align:center;color:#999;">No seating arrangement available</p>';
        }
    }
    
    // QR Code details
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
    console.log('[renderSeatGrid] Input rooms:', rooms);
    console.log('[renderSeatGrid] rooms is array?', Array.isArray(rooms));
    console.log('[renderSeatGrid] rooms length:', rooms?.length);
    
    roomSection.innerHTML = '';
    
    if (!rooms || !Array.isArray(rooms) || rooms.length === 0) {
        console.error('[renderSeatGrid] ✗ No rooms! rooms=', rooms);
        roomSection.innerHTML = '<p style="color:red;">No seating data available</p>';
        return;
    }
    
    console.log('[renderSeatGrid] Processing', rooms.length, 'room(s)');
    
    rooms.forEach((room, roomIdx) => {
        console.log(`[renderSeatGrid] Rendering room ${roomIdx}:`, room);
        
        if (!room) {
            console.warn(`[renderSeatGrid] Room ${roomIdx} is null/undefined`);
            return;
        }
        
        // Create room container
        const roomDiv = document.createElement('div');
        roomDiv.className = 'room-container';
        
        // Room header
        const header = document.createElement('div');
        header.className = 'room-header';
        header.innerHTML = `<strong>${room.building || 'Main'} - ${room.room_number || 'N/A'}</strong><span>Capacity: ${room.capacity || 0} seats</span>`;
        roomDiv.appendChild(header);

        // Department exams info
        const deptDiv = document.createElement('div');
        deptDiv.className = 'dept-info';

        if (room.department_details && room.department_details.length > 0) {
            // Get the semester of students in this room (assume all have same semester)
            const roomSemester = room.seats && room.seats.length > 0 ? room.seats.find(s => s.registration !== 'Empty')?.semester : null;
            
            // Filter department details to only those matching the room's student semester
            const filteredDetails = roomSemester ? room.department_details.filter(item => item.semester == roomSemester) : room.department_details;
            
            // Group department details by date/session
            const groupedBySlot = {};
            filteredDetails.forEach(item => {
                const key = `${item.exam_date}||${item.session}`;
                if (!groupedBySlot[key]) {
                    groupedBySlot[key] = {
                        date: item.exam_date,
                        session: item.session,
                        departments: []
                    };
                }
                groupedBySlot[key].departments.push(item);
            });

            let deptHtml = '<strong>Departments in this room:</strong><br>';
            if (roomSemester) {
                deptHtml += `Students in this room are from Semester ${roomSemester}<br><br>`;
            }
            Object.values(groupedBySlot).forEach(slot => {
                deptHtml += `<strong>${slot.date}, ${slot.session}:</strong><br>`;
                slot.departments.forEach(item => {
                    const semText = item.semester ? ` [Sem ${item.semester}]` : '';
                    deptHtml += `&nbsp;&nbsp;${item.department}${semText} - ${item.exam_name}<br>`;
                    deptHtml += `&nbsp;&nbsp;&nbsp;&nbsp;Timing: ${item.start_time} - ${item.end_time}<br>`;
                });
                deptHtml += '<br>';
            });
            deptDiv.innerHTML = deptHtml;
            roomDiv.appendChild(deptDiv);
        } else if (room.departments && room.departments.length > 0) {
            // fallback: old behavior
            const deptExamMap = {};
            if (room.seats && room.seats.length > 0) {
                room.seats.forEach(seat => {
                    if (!seat.department || seat.department === 'Empty') return;
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

        console.log(`[renderSeatGrid] Room ${roomIdx}: rowsNeeded=${rowsNeeded}, rows=${rows}, total seats in data=${room.seats?.length || 0}`);

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

                    // Find seat matching this row and column
                    const seat = room.seats?.find(s => s.row === row && s.column === col);
                    
                    if (seat) {
                        if (seat.is_eligible === true || String(seat.is_eligible).toLowerCase() === 'true') {
                            seatDiv.classList.add('eligible');
                            seatDiv.classList.remove('blocked', 'empty');
                        } else {
                            seatDiv.classList.add('blocked');
                            seatDiv.classList.remove('eligible', 'empty');
                        }
                        const reg = seat.registration || seat.registration_number || 'N/A';
                        const dept = seat.department || 'N/A';
                        seatDiv.innerHTML = `<div class="seat-num">${row}${col}</div><div class="seat-info">${reg}</div><div class="seat-dept">${dept}</div>`;
                    } else {
                        seatDiv.classList.add('empty');
                        seatDiv.classList.remove('eligible', 'blocked');
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
    
    console.log('[renderSeatGrid] ✓ Rendering complete');
}


// NOTE: lockStep5Btn handler already defined above at line 1013
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
    if (examNameQR) examNameQR.textContent = examName.value;
    if (examDateQR) examDateQR.textContent = `${examStartDate.value} → ${examEndDate.value}`;
    if (totalRoomsQR) totalRoomsQR.textContent = roomsList.length;
}

}
