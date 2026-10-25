try {
  var t = localStorage.getItem('md-theme');
  if (t) document.documentElement.dataset.theme = t;
} catch (e) { /* storage unavailable */ }
