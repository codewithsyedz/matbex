# Welcome to your Lovable project

## Project info

**URL**: https://lovable.dev/projects/REPLACE_WITH_PROJECT_ID

## How can I edit this code?

There are several ways of editing your application.

**Use Lovable**

Simply visit the [Lovable Project](https://lovable.dev/projects/REPLACE_WITH_PROJECT_ID) and start prompting.

Changes made via Lovable will be committed automatically to this repo.

**Use your preferred IDE**

If you want to work locally using your own IDE, you can clone this repo and push changes. Pushed changes will also be reflected in Lovable.

The only requirement is having Node.js & npm installed - [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating)

Follow these steps:

```sh
# Step 1: Clone the repository using the project's Git URL.
git clone <YOUR_GIT_URL>

# Step 2: Navigate to the project directory.
cd <YOUR_PROJECT_NAME>

# Step 3: Install the necessary dependencies.
npm i

# Step 4: Start the development server with auto-reloading and an instant preview.
npm run dev
```

**Edit a file directly in GitHub**

- Navigate to the desired file(s).
- Click the "Edit" button (pencil icon) at the top right of the file view.
- Make your changes and commit the changes.

**Use GitHub Codespaces**

- Navigate to the main page of your repository.
- Click on the "Code" button (green button) near the top right.
- Select the "Codespaces" tab.
- Click on "New codespace" to launch a new Codespace environment.
- Edit files directly within the Codespace and commit and push your changes once you're done.

## What technologies are used for this project?

This project is built with:

- Vite
- TypeScript
- React
- shadcn-ui
- Tailwind CSS

## How can I deploy this project?

Simply open [Lovable](https://lovable.dev/projects/REPLACE_WITH_PROJECT_ID) and click on Share -> Publish.

## Can I connect a custom domain to my Lovable project?

Yes, you can!

To connect a domain, navigate to Project > Settings > Domains and click Connect Domain.

Read more here: [Setting up a custom domain](https://docs.lovable.dev/features/custom-domain#custom-domain)

## Android POS terminal (Capacitor)

The web POS can be wrapped as a native Android app using the included Capacitor config.
The sandbox cannot produce APKs directly - export to GitHub and build locally.

### Quickstart: build and run Android

```bash
npm install                  # install JS deps
npm run android:doctor       # verify JDK 21, Android SDK, ANDROID_HOME, adb, Capacitor
npx cap add android          # one-time: scaffold the android/ folder
npm run android              # build + sync + run on device/emulator
```

Need a signed release APK?

```bash
npm run android:keystore     # one-time: generate release.keystore
cp keystore.properties.example keystore.properties   # fill in passwords
npm run android:release      # → android/app/build/outputs/apk/release/app-release.apk
```

### Full guides

- [`docs/android-local-setup.md`](./docs/android-local-setup.md) - Android Studio, SDK, emulator, Logcat, troubleshooting
- [`docs/android-release-checklist.md`](./docs/android-release-checklist.md) - Step-by-step keystore + signed APK checklist
- [`docs/android-signing.md`](./docs/android-signing.md) - Local + CI signing config details
- [`docs/terminal-api.md`](./docs/terminal-api.md) - Matbex Terminal API used by the Android app

### Pairing a terminal

The Android app communicates with the backend via the **Matbex Terminal API**.

1. **Generate a pairing code**  
   In the web app, go to **Settings → POS Terminals → Pair Android terminal** (or **New pairing code**).  
   A 6-digit code appears - it is valid for 15 minutes.

2. **Enter the code on the device**  
   Launch the Android app, tap **Pair terminal**, and type the 6-digit code.  
   The app calls the `/pair` endpoint and receives a `device_key`, which it stores in the Android Keystore.

3. **Log in as a cashier**  
   After pairing, log in with a cashier account. The app now sends both the terminal key and the cashier JWT on every request.

4. **Test connectivity**  
   Once paired and logged in, the app hits `/health` automatically. You can also verify manually in the web app: **Settings → POS Terminals** shows the paired device with its last-seen timestamp. If it is grayed out or shows "Offline", check that the device has network access and that `X-Terminal-Key` is being sent correctly.

Full API reference: [`docs/terminal-api.md`](./docs/terminal-api.md)
