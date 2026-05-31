# Shared Utility Calculator

This is a shared utility bill calculator for roommates.

## Features

- Shared Firebase Firestore storage
- Monthly bill history
- Electricity by room-use days
- Water by person-days
- Guests / temporary stays
- Room-specific gas or adjustment
- Copy result for group chat

## Local setup

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

Netlify publish directory: `dist`

## Important Firebase rule for initial testing

Use this only for testing:

```js
rules_version = '2';

service cloud.firestore {
  match /databases/{database}/documents {
    match /households/{householdId}/bills/{billId} {
      allow read, write: if true;
    }
  }
}
```

Before sharing widely, change this to a safer rule.
