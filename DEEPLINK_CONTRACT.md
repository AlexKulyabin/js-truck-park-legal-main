# Deep-link relay contract

## Public endpoint

`https://js-truck-park.web.app/deeplink.html`

The relay first attempts to open the installed application through:

`jstrackpark://js-truck-park.web.app/{route}{original-query-string}`

The original query string must be preserved without rebuilding or filtering it.

## Supported links

- Parking: `targetParkingId`, `targetLat`, `targetLng`; defaults to `homePage`.
- Shared photo: `route=sharedPhotoView`, `photoUrl`, `address`, `date`.
- Referral destination: `route=splash`, `ref`.

Chottu owns referral short links and deferred attribution. This Hosting relay is
the destination used when an installed application is opened. Parking and photo
links remain independent of Chottu.

## Store fallback

If the custom scheme does not open the application within 2.5 seconds, the
relay sends Android users to the published Google Play listing and iOS users to
the published App Store listing. Desktop users are sent to the support page.

Changing store destinations must not change the custom-scheme host, route names,
or original query-string handoff.

## Verification

Run the contract tests before deployment:

```sh
node --test test/deeplink_contract_test.js
```

Production deployment is a separate, explicit operation:

```sh
firebase deploy --only hosting:js-truck-park --project js-truck-park
```

After deployment, verify parking, shared-photo and referral URLs both with the
application terminated and already running. Also verify store fallback on a
device without the application installed.
