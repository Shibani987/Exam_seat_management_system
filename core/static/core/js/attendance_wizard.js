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
      showStep3(data.sheets, data.exam_name, currentExamId);
    } else {
      alert('Error generating sheets: '+data.message);
    }
  });
});

function showStep3(pages, examName, examId = null){
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

  // Add print-friendly stylesheet if not already added
  if (!document.getElementById('attendance-sheet-css')) {
    const link = document.createElement('link');
    link.id = 'attendance-sheet-css';
    link.rel = 'stylesheet';
    link.href = '/static/core/css/attendance_sheet_print.css';
    document.head.appendChild(link);
  }

  // Use provided examId or fall back to currentExamId
  const currentExamIdForQR = examId || currentExamId;

  // Create individual student cards instead of bulk sheets
  pages.forEach((pageMeta, pageIdx) => {
    pageMeta.students.forEach((student, studentIdx) => {
      if (!student || (!student.name && !student.registration_number && !student.roll_number)) return;

      const cardDiv = document.createElement('div');
      cardDiv.className = 'student-card';
      cardDiv.style.cssText = `
        width: 300px;
        min-height: 400px;
        border: 2px solid #1976d2;
        border-radius: 10px;
        margin: 10px;
        padding: 15px;
        background: white;
        box-shadow: 0 4px 8px rgba(0,0,0,0.1);
        display: inline-block;
        vertical-align: top;
        page-break-inside: avoid;
        break-inside: avoid;
      `;

      // Generate QR code URL for this student
      const studentPortalUrl = `${window.location.origin}/student-portal/?reg_number=${encodeURIComponent(student.registration_number || '')}&exam_id=${encodeURIComponent(currentExamIdForQR || '')}`;

      const html = `
        <div style="text-align: center; border-bottom: 1px solid #eee; padding-bottom: 10px; margin-bottom: 15px;">
          <img src="/static/core/img/logo.png" alt="logo" style="width: 60px; height: 60px; margin-bottom: 5px;" />
          <h3 style="margin: 5px 0; color: #1976d2; font-size: 16px;">CONTROLLER OF EXAMINATIONS</h3>
          <p style="margin: 2px 0; font-size: 12px;">JIS COLLEGE OF ENGINEERING</p>
          <p style="margin: 2px 0; font-size: 11px;">AN AUTONOMOUS INSTITUTE UNDER MAKAUT, W.B.</p>
        </div>

        <div style="text-align: center; margin-bottom: 15px;">
          <h4 style="margin: 5px 0; font-size: 14px;">${(examName||'').toUpperCase()}</h4>
          <p style="margin: 2px 0; font-size: 12px;">Attendance Sheet</p>
        </div>

        <div style="margin-bottom: 15px;">
          <table style="width: 100%; border-collapse: collapse; font-size: 12px;">
            <tr>
              <td style="padding: 4px 0; font-weight: bold; width: 40%;">Name:</td>
              <td style="padding: 4px 0;">${(student.name||'').toUpperCase()}</td>
            </tr>
            <tr>
              <td style="padding: 4px 0; font-weight: bold;">Registration No:</td>
              <td style="padding: 4px 0;">${(student.registration_number||'').toUpperCase()}</td>
            </tr>
            <tr>
              <td style="padding: 4px 0; font-weight: bold;">Roll No:</td>
              <td style="padding: 4px 0;">${(student.roll_number||'').toUpperCase()}</td>
            </tr>
            <tr>
              <td style="padding: 4px 0; font-weight: bold;">Branch:</td>
              <td style="padding: 4px 0;">${(pageMeta.branch||'').toUpperCase()}</td>
            </tr>
            <tr>
              <td style="padding: 4px 0; font-weight: bold;">Semester:</td>
              <td style="padding: 4px 0;">${(pageMeta.semester||'')}</td>
            </tr>
          </table>
        </div>

        <div style="text-align: center; margin: 15px 0;">
          <img src="/generate_qr/?data=${encodeURIComponent(studentPortalUrl)}" alt="QR Code" style="width: 120px; height: 120px; border: 2px solid #1976d2; padding: 5px;" />
          <p style="font-size: 10px; margin-top: 5px; color: #666;">Scan to view seat information</p>
        </div>

        <div style="margin-top: 15px; padding-top: 10px; border-top: 1px solid #eee;">
          <table style="width: 100%; border-collapse: collapse; font-size: 11px;">
            <tr>
              <td style="padding: 3px 0; text-align: center; border-right: 1px solid #eee;">
                <div style="font-weight: bold;">Present</div>
                <div style="margin-top: 8px; border: 1px solid #000; width: 30px; height: 20px; display: inline-block;"></div>
              </td>
              <td style="padding: 3px 0; text-align: center;">
                <div style="font-weight: bold;">Absent</div>
                <div style="margin-top: 8px; border: 1px solid #000; width: 30px; height: 20px; display: inline-block;"></div>
              </td>
            </tr>
          </table>
        </div>

        <div style="margin-top: 10px; text-align: center; font-size: 10px; color: #666;">
          <div>Signature of Candidate</div>
          <div style="margin-top: 15px; border-top: 1px solid #000; width: 150px; margin-left: auto; margin-right: auto;"></div>
        </div>

        <div style="margin-top: 15px; text-align: center; font-size: 10px; color: #666;">
          <div>Signature of Examiner</div>
          <div style="margin-top: 15px; border-top: 1px solid #000; width: 150px; margin-left: auto; margin-right: auto;"></div>
        </div>
      `;

      cardDiv.innerHTML = html;
      container.appendChild(cardDiv);
    });
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

