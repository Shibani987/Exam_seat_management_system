const togglePassword = document.querySelector('#togglePassword');
const password = document.querySelector('#password');

const eyeOpen = '<path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zm0 13c-3.04 0-5.5-2.46-5.5-5.5S8.96 6.5 12 6.5s5.5 2.46 5.5 5.5-2.46 5.5-5.5 5.5zm0-9a3.5 3.5 0 100 7 3.5 3.5 0 000-7z"/>';
const eyeClosed = '<path d="M12 5c-5 0-9.27 3.11-11 7.5 0.7 1.78 1.88 3.29 3.41 4.42L2 21l1.41 1.41 3.17-3.17c1.05 0.53 2.18 0.85 3.42 0.85 5 0 9.27-3.11 11-7.5-0.7-1.78-1.88-3.29-3.41-4.42L22 3l-1.41-1.41L12 5zm0 13c-3.04 0-5.5-2.46-5.5-5.5 0-0.86 0.2-1.67 0.55-2.39l7.34 7.34c-0.72 0.35-1.53 0.55-2.39 0.55zm0-9a3.5 3.5 0 00-3.5 3.5c0 0.86 0.2 1.67 0.55 2.39l7.34-7.34c-0.72-0.35-1.53-0.55-2.39-0.55z"/>';

togglePassword.addEventListener('click', () => {
  const type = password.getAttribute('type') === 'password' ? 'text' : 'password';
  password.setAttribute('type', type);
  togglePassword.innerHTML = type === 'password' ? eyeOpen : eyeClosed;
});