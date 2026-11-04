'use strict';

const sitePages = [
  ['crewboard-server.html', 'CrewBoard Server'],
  ['crewboard-small-business.html', 'About CrewBoard'],
  ['local-hostname-options.html', 'Local network names'],
  ['github-pbi-board-options.html', 'GitHub PBI board']
];
const siteNavigation = document.createElement('nav');
siteNavigation.className = 'site-navigation';
siteNavigation.setAttribute('aria-label', 'Documentation pages');
const navigationLinks = document.createElement('ul');
const currentPage = window.location.pathname.split('/').pop();
sitePages.forEach(([file, label]) => {
  const item = document.createElement('li');
  const link = document.createElement('a');
  link.href = file;
  link.textContent = label;
  if (file === currentPage) link.setAttribute('aria-current', 'page');
  item.appendChild(link);
  navigationLinks.appendChild(item);
});
siteNavigation.appendChild(navigationLinks);
document.body.prepend(siteNavigation);

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
