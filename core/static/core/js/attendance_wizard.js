// Attendance Wizard Logic
const examNameInput = document.getElementById('examName');
const nextBtn = document.getElementById('nextBtn');
const backBtn = document.getElementById('backBtn');
const cancelBtn = document.getElementById('cancelBtn');
const generateBtn = document.getElementById('generateBtn');
const fileFilter = document.getElementById('fileFilter');
const showAllBtn = document.getElementById('showAllBtn');
const selectAllFiles = document.getElementById('selectAllFiles');
const filesTableBody = document.getElementById('filesTableBody');

let allFiles = [];
let selectedFiles = [];

// Step 1: Enable Next button when exam name is entered
examNameInput.addEventListener('input', () => {
  nextBtn.disabled = examNameInput.value.trim().length === 0;
});

nextBtn.addEventListener('click', () => {
  document.getElementById('step1Content').style.display = 'none';
  document.getElementById('step2Content').style.display = 'block';
  document.getElementById('stepIndicator1').classList.remove('active');
  document.getElementById('stepIndicator2').classList.add('active');
  fetchUploadedFiles();
});

backBtn.addEventListener('click', () => {
  document.getElementById('step2Content').style.display = 'none';
  document.getElementById('step1Content').style.display = 'block';
  document.getElementById('stepIndicator2').classList.remove('active');
  document.getElementById('stepIndicator1').classList.add('active');
  generateBtn.disabled = true;
});

cancelBtn.addEventListener('click', () => {
  if (confirm('Are you sure you want to cancel? Any unsaved changes will be lost.')) {
    window.location.href = '{% url 'dashboard' %}?tab=generate-sheet';
  }
});

// Fetch uploaded files
function fetchUploadedFiles() {
  filesTableBody.innerHTML = '<tr><td colspan="4" style="text-align: center; padding: 30px; color: #999;">Loading files...</td></tr>';
  
  fetch('/get_uploaded_files/?t=' + Date.now())
    .then(r => r.json())
    .then(data => {
      if (data.status === 'success' && Array.isArray(data.files)) {
        allFiles = data.files;
        renderFilesTable(allFiles);
      } else {
        filesTableBody.innerHTML = '<tr><td colspan="4" style="text-align: center; padding: 20px; color: #999;">No files found.</td></tr>';
      }
    })
    .catch(err => {
      filesTableBody.innerHTML = '<tr><td colspan="4" style="text-align: center; padding: 20px; color: #c62828;">Error loading files.</td></tr>';
      console.error('Error:', err);
    });
}

// Render files table
function renderFilesTable(files) {
  if (!files || files.length === 0) {
    filesTableBody.innerHTML = '<tr><td colspan="4" style="text-align: center; padding: 20px; color: #999;">No files uploaded yet.</td></tr>';
    return;
  }

  filesTableBody.innerHTML = '';
  files.forEach(file => {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td><input type="checkbox" class="fileCheckbox" value="${file.id}" /></td>
      <td>${file.file_name}</td>
      <td>${file.uploaded_at || 'N/A'}</td>
      <td style="text-align: center;">${file.student_count || 0}</td>
    `;
    filesTableBody.appendChild(row);

    row.querySelector('.fileCheckbox').addEventListener('change', updateGenerateBtn);
  });
}

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
  generateBtn.disabled = checked.length === 0;
}

// Generate button
generateBtn.addEventListener('click', () => {
  const selected = Array.from(document.querySelectorAll('.fileCheckbox:checked')).map(cb => cb.value);
  if (selected.length === 0) return;

  const examName = encodeURIComponent(examNameInput.value.trim());
  const fileIds = selected.join(',');
  
  // For now, show success message (backend implementation will follow)
  alert(`Exam: ${examNameInput.value}\nSelected Files: ${selected.length}\n\nAttendance sheet generation will be processed.`);
  
  // Redirect back to dashboard
  window.location.href = '{% url 'dashboard' %}?tab=generate-sheet';
});

// Sidebar toggle
const hamburgerBtn = document.getElementById('hamburgerBtn');
const closeBtn = document.getElementById('closeBtn');
const sidebar = document.getElementById('sidebar');

if (hamburgerBtn && sidebar && closeBtn) {
  hamburgerBtn.addEventListener('click', () => {
    hamburgerBtn.classList.toggle('active');
    sidebar.classList.toggle('active');
  });

  closeBtn.addEventListener('click', () => {
    hamburgerBtn.classList.remove('active');
    sidebar.classList.remove('active');
  });
}
