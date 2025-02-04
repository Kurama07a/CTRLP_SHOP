const { ipcRenderer } = require('electron');

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('register-form').addEventListener('submit', handleSignUp);
});

async function handleSignUp(e) {
    e.preventDefault();
    const name = document.getElementById('register-name').value;
    const email = document.getElementById('register-email').value;
    const password = document.getElementById('register-password').value;
    
    try {
        const user = await ipcRenderer.invoke('sign-up', { name, email, password });
        console.log('Signed up successfully:', user);
        // Redirect to main app or show success message
        alert('Registration successful! Please sign in.');
        window.location.href = 'auth.html';
    } catch (error) {
        console.error('Sign up error:', error.message);
        alert(error.message);
    }
}