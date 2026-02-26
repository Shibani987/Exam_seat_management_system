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

// Refresh the summary and list of saved sheets
function refreshGeneratedSummary(){
  fetch('/get-generated-sheets/?t=' + Date.now())
    .then(r=>r.json()).then(d=>{
      if(d.status==='success'){
        const rows = d.sheets || [];
        document.getElementById('totalSheets').textContent = rows.length;
        const list = document.getElementById('generatedList');
        if(rows.length === 0){
          list.textContent = 'No sheets generated yet.';
        } else {
          let html = '<table style="width:100%;border-collapse:collapse;">';
          html += '<thead><tr><th>Exam</th><th>File</th><th>Sheets</th><th>Students</th><th>Actions</th></tr></thead><tbody>';
          rows.forEach(rw=>{
            html += `<tr style="border-top:1px solid #ccc;">
              <td>${rw.exam_name}</td>
              <td>${rw.file_name}</td>
              <td>${rw.sheet_count}</td>
              <td>${rw.student_count}</td>
              <td>
                <button class="viewSaved" data-id="${rw.id}">View</button>
                <button class="printSaved" data-id="${rw.id}">Print</button>
                <button class="deleteSaved" data-id="${rw.id}">Delete</button>
              </td>
            </tr>`;
          });
          html += '</tbody></table>';
          list.innerHTML = html;
          // attach handlers
          list.querySelectorAll('.viewSaved').forEach(btn=>{
            btn.onclick = () => { location.href = '/generated-sheet-view/?id=' + btn.dataset.id; };
          });
          list.querySelectorAll('.printSaved').forEach(btn=>{
            btn.onclick = () => { location.href = '/generated-sheet-view/?id=' + btn.dataset.id + '&print=1'; };
          });
          list.querySelectorAll('.deleteSaved').forEach(btn=>{
            btn.onclick = () => {
              if(!confirm('Delete all sheets for this exam?')) return;
              fetch('/delete-generated-sheet/',{method:'POST',headers:{'Content-Type':'application/json','X-CSRFToken':getCsrfToken()},body:JSON.stringify({id:btn.dataset.id})})
                .then(rr=>rr.json()).then(j=>{
                  if(j.status==='success') refreshGeneratedSummary();
                  else alert('Delete failed');
                });
            };
          });
        }
      }
    });
}

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
  // refresh list immediately
  refreshGeneratedSummary();
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
  document.getElementById('step2Content').style.display='none';
  document.getElementById('step3Content').style.display='block';
  document.getElementById('stepIndicator2').classList.remove('active');
  document.getElementById('stepIndicator3').classList.add('active');
  const container = document.getElementById('sheetsPreview');
  container.innerHTML='';
  
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
  
  pages.forEach((pageMeta, pageIdx) => {
    const sheetDiv = document.createElement('div');
    sheetDiv.className = 'attendance-sheet';
    
    // Header
    let html = `
      <div class="sheet-header">
        <div class="header-logo"><img src="/static/core/img/logo.png" alt="logo" style="height:48px;"/></div>
        <h2>Controller of Examinations</h2>
        <p>JIS College of Engineering</p>
        <p>An Autonomous Institute under MAKAUT, W.B.</p>
      </div>
      
      <div class="sheet-title">
        Attendance Sheet for ${examName || ''}
      </div>
      
      <div class="sheet-meta">
        <div style="flex: 1;">
          <div class="meta-label">Date of Examination</div>
          <div class="meta-field" style="border: 2px solid #333; min-height: 25px;"></div>
        </div>
        <div style="flex: 1;">
          <div class="meta-label">Time</div>
          <div class="meta-field" style="border: 2px solid #333; min-height: 25px;"></div>
        </div>
      </div>
      
      <div class="sheet-meta">
        <div style="flex: 1;">
          <div class="meta-label">Paper Name</div>
          <div class="meta-field" style="border: 2px solid #333; min-height: 25px;"></div>
        </div>
        <div style="flex: 1;">
          <div class="meta-label">Paper Code</div>
          <div class="meta-field" style="border: 2px solid #333; min-height: 25px;"></div>
        </div>
      </div>
      
      <table class="sheet-table">
        <thead>
          <tr>
            <th class="sl-col">Sl</th>
            <th class="name-col">Name</th>
            <th class="reg-col">Registration No</th>
            <th class="roll-col">Roll No</th>
            <th class="booklet-col">Answer<br>Booklet No</th>
            <th class="signature-col">Candidate<br>Signature</th>
          </tr>
        </thead>
        <tbody>
    `;
    
    // Add rows (20 per sheet as per image)
    for (let i = 0; i < 20; i++) {
      const student = (pageMeta.students || [])[i];
      if (student) {
        html += `
          <tr>
            <td class="sl-col">${i + 1}</td>
            <td class="name-col">${student.name || ''}</td>
            <td class="reg-col">${student.registration_number || ''}</td>
            <td class="roll-col">${student.roll_number || ''}</td>
            <td class="booklet-col"></td>
            <td class="signature-col"></td>
          </tr>
        `;
      } else {
        html += `
          <tr>
            <td class="sl-col">${i + 1}</td>
            <td class="name-col"></td>
            <td class="reg-col"></td>
            <td class="roll-col"></td>
            <td class="booklet-col"></td>
            <td class="signature-col"></td>
          </tr>
        `;
      }
    }
    
    html += `
        </tbody>
      </table>
      
      <!-- preserved footer details -->
      <div class="sheet-footer">
        <div class="footer-section">
          <div class="footer-label">No of Student Present</div>
          <div class="footer-field"></div>
        </div>
        <div class="footer-section">
          <div class="footer-label">No of Student Absent</div>
          <div class="footer-field"></div>
        </div>
        <div class="footer-section" style="flex: 1.5;">
          <div class="footer-label">Signature of Examiner (Internal)</div>
          <div class="signature-box"></div>
          <div style="font-size: 10px; margin-top: 5px;">Name (in CAPITAL):</div>
        </div>
      </div>
      
      <div style="display: flex; justify-content: space-between; gap: 30px; font-size: 11px;">
        <div>
          <div style="border-top: 1px solid #333; width: 120px; text-align: center; margin-bottom: 5px;"></div>
          <div>Signature of HoD</div>
        </div>
        <div style="flex: 1;">
          <div class="footer-label">Signature of Examiner (External)</div>
          <div style="border-top: 1px solid #333; width: 150px; margin: 20px 0;"></div>
          <div style="font-size: 10px;">Name (in CAPITAL):</div>
        </div>
      </div>
      
      <div class="sheet-footer" style="display:flex; justify-content:space-between; align-items:center; margin-top:20px;">
        <div style="font-size:12px;">
          ${pageMeta.branch ? (pageMeta.branch.toUpperCase() + '_Sem' + (pageMeta.semester || '')) : ''}
        </div>
        <div style="font-size:12px;">Page ${pageMeta.global_index} of ${pageMeta.total_sheets}</div>
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
      // mark exam complete
      fetch('/complete-exam-setup/',{
        method:'POST',
        headers:{
          'Content-Type':'application/json',
          'X-CSRFToken': getCsrfToken()
        },
        body:JSON.stringify({exam_id: currentExamId})
      }).then(rr=>rr.json()).then(dd=>{
        if(dd.status==='success'){
          alert('Attendance sheets saved');
          // refresh header summary and stay on wizard
          refreshGeneratedSummary();
        }
      });
    } else alert('Save failed: '+d.message);
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

