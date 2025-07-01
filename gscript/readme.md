# Event Scheduler - Google Apps Script Deployment Guide

This guide will help you deploy the Event Scheduler Google Apps Script files (`Code.gs` and `Events.gs`) to your Google account and set them up as a web app to get the access URL.

## Overview

This project consists of two Google Apps Script files:
- `Code.gs`: Contains the main functionality to sync events with Google Calendar
- `Events.gs`: Contains event data for AX2025

When deployed as a web app, it allows you to sync selected AX2025 events to your Google Calendar through an API endpoint.

## Deployment Instructions

### Step 1: Create a New Google Apps Script Project

1. Go to [Google Apps Script](https://script.google.com)
2. Sign in with your Google account
3. Click on "New project" to create a new script project
4. Rename your project from "Untitled project" to any name you prefer

### Step 2: Add the Script Files

#### Adding Code.gs
1. In the script editor, you'll see a default `Code.gs` file already open
2. Delete any existing code in this file
3. Copy and paste the entire contents of the `Code.gs` file from this repository

#### Adding Events.gs
1. Click the "+" button next to "Files" on the left sidebar
2. Select "Script" to create a new script file
3. Name the file `Events`
4. Copy and paste the entire contents of the `Events.gs` file from this repository

### Step 3: Save Your Project
1. Click on "File" > "Save" or use the keyboard shortcut (Ctrl+S or Cmd+S)

### Step 4: Deploy as a Web App

1. Click on the "Deploy" button in the top-right corner
2. Select "New deployment"
3. Click the gear icon next to "Select type"
4. Choose "Web app"
5. Fill in the following details:
   - Description: "Event Scheduler" (or any description you prefer)
   - Execute as: "Me" (your account)
   - Who has access: "Only myself"
6. Click "Deploy"
7. Google will show an authorization screen - click "Authorize access"
8. Grant the necessary permissions to the script (hint: the authorize button may be hidden in section like unsafe, but it is safe as long as you read the code and know what it does)
9. After successful deployment, you'll receive a URL - this is your web app URL

### Step 5: Copy Your Web App URL

The web app URL will look something like:
```
https://script.google.com/macros/s/[UNIQUE_ID]/exec
```

Save this URL as you will need it to access the web app.

## Update the Google Form URL in the event scheduler

1. Click "Google Settings" button on the bottom of the page
2. In the modal that appears, find the "Google Form URL" field
3. Paste your Google Form URL into the field
4. Click "Close" and you should see the "Sync Google" button become active

---

For more information about Google Apps Script, visit the [official documentation](https://developers.google.com/apps-script).