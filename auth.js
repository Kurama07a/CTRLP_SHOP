const { ipcRenderer } = require('electron');

document.addEventListener('DOMContentLoaded', () => {
    const signinForm = document.getElementById('signin-form');
    const signupForm = document.getElementById('signup-form');
    const showSignup = document.getElementById('show-signup');
    const showSignin = document.getElementById('show-signin');

    showSignup.addEventListener('click', (e) => {
        e.preventDefault();
        signinForm.style.display = 'none';
        signupForm.style.display = 'block';
    });

    showSignin.addEventListener('click', (e) => {
        e.preventDefault();
        signupForm.style.display = 'none';
        signinForm.style.display = 'block';
    });

    document.getElementById('login-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const shopId = document.getElementById('login-shopid').value;
        const result = await ipcRenderer.invoke('sign-in', { shopId });
        if (result.success) {
            window.location.href = 'index.html';
        } else {
            alert('Sign in failed: ' + result.error);
        }
    });

    document.getElementById('register-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const instituteName = document.getElementById('institute-name').value;
        const shopName = document.getElementById('shop-name').value;
        const location = document.getElementById('location').value;
        const contactInfo = document.getElementById('contact-info').value;
        const colorCapable = document.getElementById('color-capable').checked;
        const duplexCapable = document.getElementById('duplex-capable').checked;
        const capacity = document.getElementById('capacity').value;

        const result = await ipcRenderer.invoke('sign-up', {
            instituteName,
            shopName,
            location,
            contactInfo,
            colorCapable,
            duplexCapable,
            capacity
        });

        if (result.success) {
            window.location.href = 'index.html';
        } else {
            alert('Sign up failed: ' + result.error);
        }
    });
});