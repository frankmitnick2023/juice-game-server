// inject.js —— 自动寻找 canvas 并通知外层
(function () {
  const canvas = document.querySelector('canvas') ||
                 document.querySelector('#avatarCanvas') ||
                 document.querySelector('[id*="canvas" i]');

  if (!canvas) {
    console.warn('No canvas found for casting');
    return;
  }

  window.parent.postMessage({
    type: 'CAST_CANVAS_READY',
    canvasId: canvas.id || 'auto'
  }, '*');

  window.castCanvas = canvas;
})();