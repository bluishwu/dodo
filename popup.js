// i18n helper
const i18n = (key) => chrome.i18n.getMessage(key) || key;

document.addEventListener('DOMContentLoaded', () => {
  // Clear badge
  chrome.action.setBadgeText({ text: '' });

  // Translation
  const elements = [
    'popTitle', 'popHowTo', 'popMakeOrganized', 'popContact',
    'popStep1Title', 'popStep1Desc',
    'popStep2Title', 'popStep2Desc',
    'popStep3Title', 'popStep3Desc'
  ];
  
  elements.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = i18n(id);
  });
});
