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

function showStep3(sheets, examName){
  document.getElementById('step2Content').style.display='none';
  document.getElementById('step3Content').style.display='block';
  document.getElementById('stepIndicator2').classList.remove('active');
  document.getElementById('stepIndicator3').classList.add('active');
  const container = document.getElementById('sheetsPreview');
  container.innerHTML='';
  sheets.forEach((sheet, idx)=>{
    const div=document.createElement('div');
    div.style.marginBottom='24px';
    let html=`<h4>Sheet ${idx+1} - ${examName}</h4><table class="files-table"><thead><tr><th>Sl</th><th>Name</th><th>Roll No</th><th>Reg No</th></tr></thead><tbody>`;
    sheet.forEach((stu,i)=>{
      html+=`<tr><td>${i+1}</td><td>${stu.name}</td><td>${stu.roll_number}</td><td>${stu.registration_number}</td></tr>`;
    });
    html+='</tbody></table>'; 
    div.innerHTML=html;
    container.appendChild(div);
  });
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
          window.location.href=dd.dashboard_url;
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

