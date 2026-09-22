// jsdom's default computed style reports opacity as '' (empty string) instead of the '1' a
// real browser resolves it to, which elementHiddenByCss() would misread as opacity 0 (hidden).
// Pinning it explicitly on the root elements makes jsdom match real-browser behavior for tests
// that exercise visibleRect()/looseRect().
document.documentElement.style.opacity = '1';
document.body.style.opacity = '1';
