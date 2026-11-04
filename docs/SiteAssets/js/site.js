'use strict';

// Make overflowing tables reachable and scrollable without a pointer.
document.querySelectorAll('.table-wrap').forEach((wrapper) => {
  const caption = wrapper.querySelector('caption');
  const update = () => {
    if (wrapper.scrollWidth > wrapper.clientWidth) {
      wrapper.tabIndex = 0;
      wrapper.setAttribute('role', 'region');
      wrapper.setAttribute('aria-label', caption ? caption.textContent.trim() : 'Scrollable table');
    } else {
      wrapper.removeAttribute('tabindex');
      wrapper.removeAttribute('role');
      wrapper.removeAttribute('aria-label');
    }
  };
  update();
  if (typeof ResizeObserver === 'function') {
    new ResizeObserver(update).observe(wrapper);
  } else {
    window.addEventListener('resize', update);
  }
});
