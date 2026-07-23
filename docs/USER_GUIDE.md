# Little Sips user guide

Little Sips helps you record bottle feeds and weight measurements, spot recent
patterns, and prepare a shareable record for a clinician. It works locally in
your browser by default, including when you are offline.

> **Privacy first:** local records are erased if you clear this site's browser
> data. Export your data regularly, or use optional cloud sync when it is
> available.

## Start recording

Use **Record a bottle** to enter the quantity in millilitres, date, 24-hour
time, and an optional note. Select **Save bottle** when you are done.

Use **Record a weight** to enter a weight in kilograms and its measurement
date, then select **Save weight**.

![Bottle and weight forms, 24-hour summary, trends, and measure history](images/logging-and-summary.png)

After saving, the **Last 24 hours** cards show the bottle count, total
consumed, and latest weight. Once a weight is present, Little Sips also shows a
theoretical daily quantity using the Appert rule. This is only an indicative
guide, not medical advice—follow your healthcare professional's advice and
your baby's cues.

## Review trends and records

The **Trends** section has four time ranges:

- **24 hours** for recent activity;
- **7 days** for the previous week;
- **All time** for every saved record; and
- **Custom** to choose a start and end date.

It displays bottle quantity, weight evolution, bottles per day, and rolling
24-hour quantity where data is available.

The **All measures** section keeps records grouped by day. Switch between
**Quantities** and **Weights**, expand a day as needed, and use **Edit** or
**Delete** beside a record to correct it.

![Custom trend range controls and the editable feed history](images/custom-trends-and-history.png)

## Back up and restore data

Select **Export data** to download a JSON backup of the records held on this
device. Keep this file somewhere safe.

To restore a backup, select **Import data** and choose its JSON file. Imported
records are merged with existing records rather than replacing them, so you can
use it to move or recover data without losing the current history.

## Create a clinician-ready PDF

Select **Share report** to open the report options. Choose a date range
(last 24 hours, seven days, all data, or a custom range), then choose whether
to include bottle feeds, weight measurements, and comments. The preview shows
how many records will be included.

Select **Share PDF** to create a PDF in the browser. Depending on your device,
you can share it through the system share sheet or download it. Report
generation stays on your device; it does not upload the selected data.

![Report options with range, content controls, and preview](images/share-report.png)

## Change language

Open **Language** in the header and choose **English**, **Français**,
**Español**, or **Deutsch**. The interface changes immediately.

![Language selector](images/language-selector.png)

## Optional cloud sync

If the service has been configured by its administrator, **Sign in** lets you
request an email magic link. Once signed in, Little Sips can sync records
between your devices. Before any existing local records are uploaded, the app
asks for your confirmation. You can sign out or delete your cloud copy from
the sync controls.

Without a configured sign-in service, Little Sips remains fully functional in
local-only mode and makes no cloud requests.
