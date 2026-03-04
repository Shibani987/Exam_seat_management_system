// Attendance Wizard Logic

// Helper function to get CSRF token from cookies
function getCsrfToken() {
  const name = 'csrftoken';
  let cookieValue = null;
  if (document.cookie && document.cookie !== '') {
    const cookies = document.cookie.split(';');
    for (let i = 0; i < cookies.length; i++) {
      const cookie = cookies[i].trim();
      if (cookie.substring(0, name.length + 1) === (name + '=')) {
        cookieValue = decodeURIComponent(cookie.substring(name.length + 1));
        break;
      }
    }
  }
  return cookieValue;
}

const examNameInput = document.getElementById('examName');
const nextBtn = document.getElementById('nextBtn');
const backBtn = document.getElementById('backBtn');
const generateBtn = document.getElementById('generateBtn');
const fileFilter = document.getElementById('fileFilter');
const showAllBtn = document.getElementById('showAllBtn');
const selectAllFiles = document.getElementById('selectAllFiles');
const filesTableBody = document.getElementById('filesTableBody');

let allFiles = [];
let selectedFiles = [];
let currentExamId = null;
let currentFileId = null;
let generatedSheets = []; // array of arrays


// Initialize a temporary exam when the page loads
window.addEventListener('DOMContentLoaded', () => {
  fetch('/init-temp-exam/?t=' + Date.now())
    .then(r => r.json())
    .then(d => {
      if (d.status === 'success') {
        currentExamId = d.exam_id;
      } else {
        alert('Error initializing temporary exam. Please reload.');
        console.error('init_temp_exam error', d);
      }
    })
    .catch(err => {
      console.error('init_temp_exam fetch failed', err);
      alert('Error initializing temporary exam. Please reload.');
    });
  // no summary section any more
});

// Step 1: Enable Next button when exam name is entered
examNameInput.addEventListener('input', () => {
  nextBtn.disabled = examNameInput.value.trim().length === 0;
});

nextBtn.addEventListener('click', () => {
  const name = examNameInput.value.trim();
  if (!currentExamId) {
    alert('Temporary exam ID missing, please reload the page.');
    return;
  }
  // update temporary exam name
  fetch('/update-temp-exam/', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-CSRFToken': getCsrfToken()
    },
    body: JSON.stringify({exam_id: currentExamId, name})
  }).then(r=>r.json()).then(d=>{
    if (d.status !== 'success') {
      console.error('Name update failed', d);
    }
    // proceed to step2 anyway
    document.getElementById('step1Content').style.display = 'none';
    document.getElementById('step2Content').style.display = 'block';
    document.getElementById('stepIndicator1').classList.remove('active');
    document.getElementById('stepIndicator2').classList.add('active');
    fetchUploadedFiles();
  });
});

backBtn.addEventListener('click', () => {
  document.getElementById('step2Content').style.display = 'none';
  document.getElementById('step1Content').style.display = 'block';
  document.getElementById('stepIndicator2').classList.remove('active');
  document.getElementById('stepIndicator1').classList.add('active');
  generateBtn.disabled = true;
});


// Fetch uploaded files
function fetchUploadedFiles() {
  filesTableBody.innerHTML = '<tr><td colspan="2" style="text-align: center; padding: 30px; color: #999;">Loading files...</td></tr>';
  
  fetch('/get_uploaded_files/?t=' + Date.now())
    .then(r => {
      if (!r.ok) {
        filesTableBody.innerHTML = '<tr><td colspan="2" style="text-align: center; padding: 20px; color: #c62828;">Error fetching files (' + r.status + ')</td></tr>';
        return r.json().catch(() => null);
      }
      return r.json();
    })
    .then(data => {
      if (!data) return;
      console.log('uploaded files response', data);
      if (data.status === 'success' && Array.isArray(data.files)) {
        allFiles = data.files;
        renderFilesTable(allFiles);
      } else {
        filesTableBody.innerHTML = '<tr><td colspan="2" style="text-align: center; padding: 20px; color: #999;">No files found.</td></tr>';
      }
    })
    .catch(err => {
      filesTableBody.innerHTML = '<tr><td colspan="2" style="text-align: center; padding: 20px; color: #c62828;">Error loading files.</td></tr>';
      console.error('Error:', err);
    });
}

// Render files table
function renderFilesTable(files) {
  if (!files || files.length === 0) {
    filesTableBody.innerHTML = '<tr><td colspan="2" style="text-align: center; padding: 20px; color: #999;">No files uploaded yet.</td></tr>';
    return;
  }

  filesTableBody.innerHTML = '';
  files.forEach(file => {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td><input type="checkbox" class="fileCheckbox" value="${file.id}" /></td>
      <td>${file.file_name}</td>
    `;
    filesTableBody.appendChild(row);

    row.querySelector('.fileCheckbox').addEventListener('change', updateGenerateBtn);
  });
}

// Generate sheets when file selected
generateBtn.addEventListener('click', () => {
  const selected = Array.from(document.querySelectorAll('.fileCheckbox:checked')).map(cb => cb.value);
  if (selected.length === 0) return;
  if (selected.length > 1) {
    alert('Please select only one file at a time');
    return;
  }
  if (!currentExamId) {
    alert('Temporary exam missing');
    return;
  }
  const fileId = selected[0];
  currentFileId = fileId;
  fetch('/generate-sheets/', {
    method:'POST',
    headers:{
      'Content-Type':'application/json',
      'X-CSRFToken': getCsrfToken()
    },
    body:JSON.stringify({exam_id: currentExamId, file_id: fileId})
  }).then(r=>r.json()).then(data=>{
    if (data.status==='success'){
      generatedSheets = data.sheets;
      showStep3(data.sheets, data.exam_name);
    } else {
      alert('Error generating sheets: '+data.message);
    }
  });
});

function showStep3(pages, examName){
  // pages: array of { students: [...], branch: '', semester: '', page_index: N, total_pages: M }
  // if wizard DOM elements exist, toggle them; view page doesn't have these
  const step2Elem = document.getElementById('step2Content');
  const step3Elem = document.getElementById('step3Content');
  if (step2Elem && step3Elem) {
    step2Elem.style.display = 'none';
    step3Elem.style.display = 'block';
    document.getElementById('stepIndicator2').classList.remove('active');
    document.getElementById('stepIndicator3').classList.add('active');
  }
  const container = document.getElementById('sheetsPreview');
  if (!container) return;  // nothing to render on this page
  container.innerHTML = '';
  
  // save for later (save endpoint uses generatedSheets)
  generatedSheets = pages;

  // prepare serial counters for continuous SL numbers per branch/semester
  const serialCounters = {};

  // Add print-friendly stylesheet if not already added
  if (!document.getElementById('attendance-sheet-css')) {
    const link = document.createElement('link');
    link.id = 'attendance-sheet-css';
    link.rel = 'stylesheet';
    link.href = '/static/core/css/attendance_sheet_print.css';
    document.head.appendChild(link);
  }
  
  pages.forEach((pageMeta, pageIdx) => {
    // establish a unique key for branch+semester so serials continue properly
    const key = `${pageMeta.branch||''}_${pageMeta.semester||''}`;
    if (!(key in serialCounters)) {
      serialCounters[key] = 0;
    }

    const sheetDiv = document.createElement('div');
    sheetDiv.className = 'attendance-sheet';
    
    // Header (logo left, text centered)
    let html = `
      <div class="sheet-header">
        <div class="header-logo"><img src="/static/core/img/logo.png" alt="logo" /></div>
        <div class="header-text">
          <h2>CONTROLLER OF EXAMINATIONS</h2>
          <p>JIS COLLEGE OF ENGINEERING</p>
          <p>AN AUTONOMOUS INSTITUTE UNDER MAKAUT, W.B.</p>
        </div>
      </div>
      
      <div class="sheet-title">
        Attendance Sheet for ${(examName||'').toUpperCase()}
      </div>
      
      <div class="sheet-meta">
        <div style="flex: 1;">
          <div class="meta-label">Date of Examination</div>
          <div class="meta-field"></div>
        </div>
        <div style="flex: 1;">
          <div class="meta-label">Time</div>
          <div class="meta-field"></div>
        </div>
      </div>
      
      <div class="sheet-meta">
        <div style="flex: 1;">
          <div class="meta-label">Paper Name</div>
          <div class="meta-field"></div>
        </div>
        <div style="flex: 1;">
          <div class="meta-label">Paper Code</div>
          <div class="meta-field"></div>
        </div>
      </div>
      
      <table class="sheet-table">
        <thead>
          <tr>
            <th class="sl-col">SL</th>
            <th class="name-col">NAME</th>
            <th class="reg-col">REGISTRATION NO</th>
            <th class="roll-col">ROLL NO</th>
            <th class="booklet-col">ANSWER<br>BOOKLET NO</th>
            <th class="signature-col">CANDIDATE<br>SIGNATURE</th>
          </tr>
        </thead>
        <tbody>
    `;
    
    // Add rows (20 per sheet as per image) with continuous serial numbers per branch/semester
    // serialCounters will be initialised outside this loop
    for (let i = 0; i < 20; i++) {
      const student = (pageMeta.students || [])[i];
      let slText = '';
      if (student && (student.name || student.registration_number || student.roll_number)) {
        serialCounters[key] += 1;
        slText = serialCounters[key];
      }
      html += `
          <tr>
            <td class="sl-col">${slText}</td>
            <td class="name-col">${student ? (student.name||'').toUpperCase() : ''}</td>
            <td class="reg-col">${student ? (student.registration_number||'').toUpperCase() : ''}</td>
            <td class="roll-col">${student ? (student.roll_number||'').toUpperCase() : ''}</td>
            <td class="booklet-col"></td>
            <td class="signature-col"></td>
          </tr>
        `;
    }
    
    html += `
        </tbody>
      </table>
      
      <!-- first footer row: present/absent on left, internal signature on right -->
      <div class="sheet-footer-row">
        <div class="footer-left">
          <div class="footer-section small">
            <div class="footer-label">No of Student Present</div>
            <div class="footer-field"></div>
          </div>
          <div class="footer-section small">
            <div class="footer-label">No of Student Absent</div>
            <div class="footer-field"></div>
          </div>
        </div>
        <div class="footer-right-internal">
          <div class="footer-label">Signature of Examiner (Internal)</div>
          <div class="signature-box"></div>
          <div class="name-caption">Name (in CAPITAL):</div>
        </div>
      </div>
      
      <!-- second footer row: HOD left, external right -->
      <div class="sheet-footer-row" style="margin-top:20px;">
        <div class="footer-left-hod">
          <div class="hod-line"></div>
          <div>Signature of HoD</div>
        </div>
        <div class="footer-right-external">
          <div class="footer-label">Signature of Examiner (External)</div>
          <div class="external-line"></div>
          <div class="name-caption">Name (in CAPITAL):</div>
        </div>
      </div>
      
      <div class="sheet-footer" style="display:flex; justify-content:space-between; align-items:center; margin-top:20px;">
        <div style="font-size:12px;">
          ${pageMeta.branch ? (pageMeta.branch.toUpperCase() + '_Sem ' + (pageMeta.semester || '')) : ''}
        </div>
        <div style="font-size:12px;">Page ${pageMeta.page_index} of ${pageMeta.total_pages}</div>
      </div>
    `;
    
    sheetDiv.innerHTML = html;
    container.appendChild(sheetDiv);
  });
  
  // no print button (handled by browser or user can press Ctrl+P)
}

// Save button
const saveBtn = document.getElementById('saveBtn');
const backToStep2Btn = document.getElementById('backToStep2Btn');

if (backToStep2Btn) {
  backToStep2Btn.addEventListener('click', () => {
    document.getElementById('step3Content').style.display = 'none';
    document.getElementById('step2Content').style.display = 'block';
    document.getElementById('stepIndicator3').classList.remove('active');
    document.getElementById('stepIndicator2').classList.add('active');
    updateGenerateBtn();
  });
}

saveBtn.addEventListener('click', ()=>{
  if (!currentExamId) return;
  fetch('/save-generated-sheets/',{
    method:'POST',
    headers:{
      'Content-Type':'application/json',
      'X-CSRFToken': getCsrfToken()
    },
    body:JSON.stringify({exam_id: currentExamId, file_id: currentFileId, sheets: generatedSheets})
  }).then(r=>r.json()).then(d=>{
    if(d.status==='success'){
      alert('Attendance sheets saved');
      // clear currentExamId so unload handler won't delete it
      currentExamId = null;
      // redirect to homepage
      window.location.href = '/';
    } else {
      alert('Save failed: '+d.message);
    }
  }).catch(err=>{
    console.error('Save sheets error', err);
    alert('Save failed');
  });
});


// File filter
fileFilter.addEventListener('input', () => {
  const q = fileFilter.value.trim().toLowerCase();
  const filtered = allFiles.filter(f => f.file_name.toLowerCase().includes(q));
  renderFilesTable(filtered);
});

showAllBtn.addEventListener('click', () => {
  fileFilter.value = '';
  renderFilesTable(allFiles);
});

// Select all files
selectAllFiles.addEventListener('change', () => {
  document.querySelectorAll('.fileCheckbox').forEach(cb => {
    cb.checked = selectAllFiles.checked;
  });
  updateGenerateBtn();
});

// Update Generate button state
function updateGenerateBtn() {
  const checked = document.querySelectorAll('.fileCheckbox:checked');
  // enable only when exactly one file is selected
  generateBtn.disabled = checked.length !== 1;
}


// When the page unloads (refresh/navigate away) delete any temporary exam
window.addEventListener('beforeunload', () => {
  if (currentExamId) {
    // use fetch with keepalive flag (more reliable than sendBeacon and supports CSRF)
    const payload = JSON.stringify({exam_id: currentExamId});
    fetch('/delete-temp-exam/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRFToken': getCsrfToken()
      },
      body: payload,
      keepalive: true
    }).catch(() => {}); // silently ignore errors
  }
});

