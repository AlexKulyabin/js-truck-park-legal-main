const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const html = fs.readFileSync(
  path.join(__dirname, '..', 'public', 'deeplink.html'),
  'utf8',
);
const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];

assert.ok(script, 'deeplink.html must contain an inline script');

function runRelay(search, userAgent = 'Desktop') {
  const location = {search, href: ''};
  let delayedRedirect;
  const window = {location};

  vm.runInNewContext(script, {
    URLSearchParams,
    navigator: {userAgent, vendor: ''},
    setTimeout(callback, delay) {
      assert.equal(delay, 2500);
      delayedRedirect = callback;
    },
    window,
  });

  window.onload();
  const appLink = location.href;
  delayedRedirect();

  return {appLink, storeLink: location.href};
}

test('preserves parking parameters in the custom-scheme handoff', () => {
  const search =
    '?targetParkingId=parking-123&targetLat=52.23&targetLng=21.01';
  const result = runRelay(search);

  assert.equal(
    result.appLink,
    `jstrackpark://js-truck-park.web.app/homePage${search}`,
  );
});

test('preserves encoded shared-photo parameters', () => {
  const search =
    '?route=sharedPhotoView&photoUrl=https%3A%2F%2Fexample.com%2Fp.jpg&address=Main%20Street&date=2026-07-29';
  const result = runRelay(search);

  assert.equal(
    result.appLink,
    `jstrackpark://js-truck-park.web.app/sharedPhotoView${search}`,
  );
});

test('preserves referral parameters', () => {
  const search = '?route=splash&ref=REF-CODE-123';
  const result = runRelay(search);

  assert.equal(
    result.appLink,
    `jstrackpark://js-truck-park.web.app/splash${search}`,
  );
});

test('uses the published Google Play listing on Android', () => {
  const result = runRelay('?route=splash&ref=TEST', 'Android');

  assert.equal(
    result.storeLink,
    'https://play.google.com/store/apps/details?id=com.mycompany.jstrackpark',
  );
});

test('uses the published App Store listing on iOS', () => {
  const result = runRelay('?route=splash&ref=TEST', 'iPhone');

  assert.equal(
    result.storeLink,
    'https://apps.apple.com/app/id6773738276',
  );
});

test('uses the support page on desktop', () => {
  const result = runRelay('?route=splash&ref=TEST');

  assert.equal(
    result.storeLink,
    'https://js-truck-park.web.app/support.html',
  );
});
