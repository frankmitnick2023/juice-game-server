(function () {
  const canvas = document.querySelector('canvas') ||
                 document.querySelector('#avatarCanvas') ||
                 document.querySelector('[id*="canvas" i]');
  if (!canvas) return console.warn('No canvas for casting');
  window.parent.postMessage({ type: 'CAST_CANVAS_READY' }, '*');
  window.castCanvas = canvas;
})();