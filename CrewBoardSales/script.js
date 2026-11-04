/* global $, Isotope, mermaid */
(function ($) {
  'use strict';

  $('#current-year').text(new Date().getFullYear());

  const grid = document.querySelector('.feature-grid');
  let featureGrid;

  if (grid && typeof Isotope === 'function') {
    featureGrid = new Isotope(grid, {
      itemSelector: '.feature-card',
      layoutMode: 'fitRows',
      percentPosition: true
    });
  }

  $('.filter-button').on('click', function () {
    const filter = $(this).data('filter');
    $('.filter-button').removeClass('is-active').attr('aria-pressed', 'false');
    $(this).addClass('is-active').attr('aria-pressed', 'true');

    if (featureGrid) {
      featureGrid.arrange({ filter: filter });
      return;
    }

    $('.feature-card').each(function () {
      $(this).toggle(filter === '*' || $(this).is(filter));
    });
  });

  if (typeof mermaid !== 'undefined') {
    mermaid.initialize({
      startOnLoad: true,
      theme: 'base',
      securityLevel: 'strict',
      themeVariables: {
        primaryColor: '#e7eee5',
        primaryTextColor: '#263b32',
        primaryBorderColor: '#adc2ae',
        lineColor: '#738276',
        secondaryColor: '#f8f6ef',
        tertiaryColor: '#f2d795',
        fontFamily: '"DM Sans", sans-serif'
      }
    });
  }
})(jQuery);
