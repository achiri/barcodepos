# System Requirements Specification (SRS)

## Barcode Sales App for African Micro-Retailers

**Version:** 1.0  
**Date:** July 2026  
**Status:** Draft  

---

## Table of Contents

1. [Introduction](#1-introduction)
2. [Overall Description](#2-overall-description)
3. [System Architecture](#3-system-architecture)
4. [Functional Requirements](#4-functional-requirements)
5. [Data Model](#5-data-model)
6. [Google Sheets Schema](#6-google-sheets-schema)
7. [Non-Functional Requirements](#7-non-functional-requirements)
8. [UI/UX Requirements](#8-uiux-requirements)
9. [Constraints and Assumptions](#9-constraints-and-assumptions)
10. [Appendix: Glossary](#10-appendix-glossary)

---

## 1. Introduction

### 1.1 Purpose

This document specifies the functional and non-functional requirements for a Progressive Web App (PWA) that enables micro-retailers to manage inventory, process sales, and track business data using barcode scanning and Google Sheets as a zero-cost database backend.

### 1.2 Scope

The system covers:

- **Inventory Management** — Add products via barcode scan, set prices, track stock levels
- **Point of Sale (POS) Checkout** — Scan items, build invoices, record payments
- **Receipt Generation** — Create and share digital receipts with customers
- **Google Sheets Integration** — All data persisted to a Google Sheet in real-time
- **Stock Alerts** — Notify users when inventory drops below defined thresholds
- **Sales Dashboard** — Web-based view of sales history, top products, and summaries

### 1.3 Definitions, Acronyms, and Abbreviations

| Term | Definition |
|---|---|
| **PWA** | Progressive Web App — a web application that can be installed on a device and work offline |
| **POS** | Point of Sale — the checkout/transaction processing interface |
| **GS** | Google Sheets — the cloud spreadsheet used as the database backend |
| **GAS** | Google Apps Script — JavaScript runtime for extending Google Workspace apps |
| **Barcode** | Machine-readable data (EAN-13, UPC-A, Code 128, QR) encoded as parallel lines or a matrix |
| **IndexedDB** | Client-side NoSQL database built into modern browsers for offline data storage |
| **Low Stock Threshold** | The minimum quantity of a product before an alert is triggered |

### 1.4 References

- WCAG 2.1 Accessibility Guidelines
- Google Sheets API v4 Documentation
- W3C Web App Manifest — PWA specification
- W3C Service Workers — Offline capability specification

---

## 2. Overall Description

### 2.1 Product Perspective

The system is a **client-only PWA**. There is no traditional server backend. All data is:

1. Stored locally in the browser's IndexedDB for offline operation
2. Synced to a user-owned Google Sheet when connectivity is available

The user sets up one Google Sheet (via a template provided by the app) which serves as the canonical data store. The app communicates with the sheet via a Google Apps Script web API deployed to the user's Google account.

### 2.2 User Characteristics

| User Role | Description | Tech Proficiency |
|---|---|---|
| **Store Owner** | Manages inventory, sets prices, reviews sales | Low–Medium |
| **Cashier** | Processes customer checkouts | Low |
| **Multi-store Manager** | Oversees multiple locations (future phase) | Medium |

### 2.3 Operating Environment

- **Devices:** Android smartphones (primary target), iOS phones, desktop/laptop browsers
- **OS:** Android 8+, iOS 14+, Windows 10+, macOS 10.15+
- **Browsers:** Chrome 80+, Firefox 75+, Safari 14+, Samsung Internet 15+
- **Connectivity:** Online required for initial setup and data sync; offline mode for checkout
- **Storage:** At least 50 MB free (IndexedDB for product cache + transaction queue)

### 2.4 User Needs and Pain Points Addressed

| User Need | Current Workaround | How System Addresses It |
|---|---|---|
| Know stock levels without counting shelves | Manually checking each product | Real-time inventory view in app and Google Sheet |
| Set and enforce consistent prices | Label gun, masking tape, memory | Price stored per product, shown at scan |
| Speed up checkout | Manual calculator + notebook | Barcode scan, auto-calculate totals |
| Give customers proof of purchase | Handwritten receipt | Digital receipt shared via WhatsApp |
| Track daily sales | Add up notebook at end of day | Auto-recorded in Google Sheet, dashboard view |
| Know when to reorder | Guess / wait until stock is zero | Low stock alerts with customisable thresholds |

### 2.5 Assumptions and Dependencies

- The user has a Google account (free) and basic familiarity with Google Sheets
- The user's phone has a camera capable of barcode scanning (most smartphones since 2018)
- The user has internet access at least periodically (for initial setup and sync)
- The app does not integrate directly with mobile money APIs — payment recording is manual
- Barcode lookup uses open databases (e.g., Open Food Facts, UPCDatabase.org) or manual entry for products not found

---

## 3. System Architecture

### 3.1 High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    PWA (Client-Side)                         │
│                                                             │
│  ┌────────────┐  ┌──────────────┐  ┌─────────────────────┐ │
│  │  Scanner   │  │   POS/       │  │   Dashboard &       │ │
│  │  Module    │  │   Checkout   │  │   Back Office       │ │
│  └─────┬──────┘  └──────┬───────┘  └──────────┬──────────┘ │
│        │                │                      │            │
│  ┌─────┴────────────────┴──────────────────────┴──────────┐ │
│  │              IndexedDB (Local Cache)                    │ │
│  │   - Products lookup table                               │ │
│  │   - Pending transactions (offline queue)                │ │
│  │   - Sync status metadata                                │ │
│  └────────────────────────┬────────────────────────────────┘ │
│                           │                                   │
│  ┌────────────────────────┴────────────────────────────────┐ │
│  │              Sync Engine (Online/Offline)                │ │
│  │   - Periodically syncs IndexedDB ↔ Google Sheets        │ │
│  │   - Queues writes when offline, replays when online     │ │
│  └────────────────────────┬────────────────────────────────┘ │
└───────────────────────────┼─────────────────────────────────┘
                            │ HTTPS / REST
                            ▼
┌───────────────────────────────────────────────────────────────┐
│           Google Apps Script Web API (doGet / doPost)         │
│                                                               │
│   - Reads from and writes to the user's Google Sheet          │
│   - Validates data, returns JSON                              │
│   - Deployed as a bound script to the template sheet          │
└───────────────────────────┬───────────────────────────────────┘
                            │
                            ▼
┌───────────────────────────────────────────────────────────────┐
│              Google Sheet (User-Owned)                        │
│                                                               │
│   ┌─────────────┐  ┌──────────┐  ┌─────────────┐             │
│   │  Products   │  │  Sales   │  │  Settings   │             │
│   │  (Tab 1)    │  │  (Tab 2) │  │  (Tab 3)    │             │
│   └─────────────┘  └──────────┘  └─────────────┘             │
└───────────────────────────────────────────────────────────────┘
```

### 3.2 Data Flow

#### Inventory Setup Flow
```
User scans barcode → App queries offline cache + online barcode DB
  → Product name resolved (or user enters manually)
  → User enters cost price, selling price, quantity
  → App writes to IndexedDB + queues sync to Google Sheets
  → Sync engine writes row to Products sheet tab
```

#### Checkout Flow
```
Cashier opens checkout → Scans first item barcode
  → App looks up product in IndexedDB cache
  → Product + price added to invoice line items
  → Repeat for all items
  → Invoice total calculated
  → Cashier enters payment amount → change calculated
  → On "Complete Sale": transaction saved to IndexedDB + synced to Sales sheet
  → Receipt generated (HTML or PDF) → shared via WhatsApp or printed
```

#### Stock Alert Flow
```
After each sale or inventory change:
  → App checks product quantity against low-stock threshold
  → If quantity ≤ threshold: trigger in-app notification
  → (Future: send SMS/WhatsApp alert)
```

---

## 4. Functional Requirements

### 4.1 Inventory Management

| ID | Requirement | Priority | Notes |
|---|---|---|---|
| **INV-01** | The system shall allow the user to scan a barcode using the device camera | **Critical** | |
| **INV-02** | The system shall attempt to auto-resolve the product name from an online barcode database (e.g., Open Food Facts, UPCDatabase.org) | High | Fallback to manual entry on failure |
| **INV-03** | The system shall allow the user to manually enter a product name, barcode, and category | **Critical** | For products not found in databases |
| **INV-04** | The system shall allow the user to set the following fields per product: selling price (required), cost price (optional), low-stock threshold (default 5), unit (piece/kg/litre) | **Critical** | |
| **INV-05** | The system shall store all product data in IndexedDB and sync to the Google Sheets Products tab | **Critical** | |
| **INV-06** | The system shall allow the user to view all products in a searchable list | High | |
| **INV-07** | The system shall allow the user to edit product prices and thresholds after creation | High | |
| **INV-08** | The system shall allow the user to delete a product (soft delete with archive flag) | Medium | |
| **INV-09** | The system shall allow the user to add stock quantity to an existing product | **Critical** | "Receive stock" workflow |
| **INV-10** | The system shall display the current stock quantity for each product on the product list | **Critical** | |

### 4.2 Checkout / POS

| ID | Requirement | Priority | Notes |
|---|---|---|---|
| **POS-01** | The system shall allow the cashier to open a new sale session | **Critical** | |
| **POS-02** | The system shall allow the cashier to scan a product barcode to add it to the current invoice | **Critical** | |
| **POS-03** | The system shall allow the cashier to manually search and select a product to add to invoice | High | For damaged/unscannable barcodes |
| **POS-04** | The system shall display the invoice in real-time: line items, quantities, unit prices, line totals, running grand total | **Critical** | |
| **POS-05** | The system shall allow the cashier to adjust quantity of a line item (increase or decrease) | **Critical** | |
| **POS-06** | The system shall allow the cashier to remove a line item from the invoice | **Critical** | |
| **POS-07** | The system shall calculate and display the grand total of all line items | **Critical** | |
| **POS-08** | The system shall allow the cashier to enter the amount tendered by the customer | **Critical** | |
| **POS-09** | The system shall calculate and display the change due to the customer | **Critical** | |
| **POS-10** | The system shall support multiple payment methods: cash (default), mobile money, bank transfer | High | |
| **POS-11** | The system shall allow the cashier to finalise the sale only when the amount tendered ≥ total | **Critical** | |
| **POS-12** | The system shall decrement the product's stock quantity immediately upon sale finalisation | **Critical** | Both locally and in sync queue |
| **POS-13** | The system shall prevent checkout if a product's stock is zero (optional override for manager) | Medium | Configurable setting |
| **POS-14** | The system shall allow the cashier to void/cancel the current invoice | High | Voided invoices marked but not deleted |
| **POS-15** | The system shall allow the cashier to quickly call up the previous sale (last receipt view) | Medium | |

### 4.3 Receipts

| ID | Requirement | Priority | Notes |
|---|---|---|---|
| **REC-01** | Upon sale completion, the system shall immediately generate a receipt | **Critical** | |
| **REC-02** | The receipt shall display: store name, date/time, transaction ID, itemised list, totals, payment method, change | **Critical** | |
| **REC-03** | The system shall allow the user to share the receipt via the device's native share sheet (WhatsApp, email, SMS, Bluetooth) | High | |
| **REC-04** | The system shall allow the receipt to be saved as a PDF on the device | High | Using browser print-to-PDF or jsPDF |
| **REC-05** | The system shall maintain a receipt history accessible from the dashboard | Medium | |
| **REC-06** | The system shall allow reprinting/re-sharing of any past receipt | Medium | |

### 4.4 Google Sheets Integration

| ID | Requirement | Priority | Notes |
|---|---|---|---|
| **GAS-01** | The system shall provide a one-click Google Sheet template creation flow | **Critical** | User clicks link → makes a copy of template |
| **GAS-02** | The system shall deploy a Google Apps Script web app bound to the user's sheet | **Critical** | Provides REST API for reads/writes |
| **GAS-03** | The system shall sync product data from IndexedDB to the Products sheet tab | **Critical** | |
| **GAS-04** | The system shall sync sales transactions to the Sales sheet tab | **Critical** | |
| **GAS-05** | The system shall read product data from the sheet on initial load and periodic refresh | **Critical** | |
| **GAS-06** | The system shall handle Google Apps Script API quotas (daily triggers, execution time) gracefully | High | Batch writes, exponential backoff |
| **GAS-07** | The system shall show sync status indicators (last synced, pending changes, error state) | High | |
| **GAS-08** | The system shall provide a manual "Sync Now" button | Medium | |
| **GAS-09** | The system shall store the user's sheet ID and GAS web app URL in localStorage after initial setup | **Critical** | |

### 4.5 Stock Alerts and Notifications

| ID | Requirement | Priority | Notes |
|---|---|---|---|
| **ALR-01** | After every sale or stock update, the system shall check each affected product against its low-stock threshold | **Critical** | |
| **ALR-02** | If stock quantity ≤ threshold, the system shall display an in-app notification badge/alert | High | |
| **ALR-03** | The system shall provide a dashboard view showing all products that are low in stock or out of stock | High | |
| **ALR-04** | The system shall allow the user to set a per-product low-stock threshold (default 5) | High | |
| **ALR-05** | The system shall optionally support sending notifications via the browser's Notification API when the page is open | Medium | |
| **ALR-06** | (Future) The system shall send stock alerts via SMS or WhatsApp message | Future | |

### 4.6 Dashboard and Reporting

| ID | Requirement | Priority | Notes |
|---|---|---|---|
| **DASH-01** | The system shall provide a dashboard view accessible from the main navigation | High | |
| **DASH-02** | The dashboard shall display: total sales today, total sales this week, total sales this month | High | |
| **DASH-03** | The dashboard shall display the count of low-stock and out-of-stock products | High | |
| **DASH-04** | The dashboard shall display top 5 selling products (by quantity or revenue) | Medium | |
| **DASH-05** | The dashboard shall display recent transactions (last 10 sales) | Medium | |
| **DASH-06** | The system shall allow the user to view the full sales history in a table with date filters | Medium | |
| **DASH-07** | The system shall allow export of sales data as CSV (via Google Sheet natively) | Low | |

### 4.7 Offline Operation

| ID | Requirement | Priority | Notes |
|---|---|---|---|
| **OFF-01** | The system shall load and cache the product catalogue in IndexedDB on first sync | **Critical** | |
| **OFF-02** | The system shall allow full checkout flow when the device is offline | **Critical** | |
| **OFF-03** | When offline, sales transactions shall be queued in IndexedDB with a "pending sync" status | **Critical** | |
| **OFF-04** | When connectivity is restored, the system shall automatically replay queued transactions against the Google Sheet | **Critical** | |
| **OFF-05** | The system shall handle sync conflicts gracefully — last-write-wins by default, with manual resolution option | High | |
| **OFF-06** | The system shall indicate clearly when operating in offline mode vs. online mode | High | |
| **OFF-07** | The PWA service worker shall cache the app shell (HTML, CSS, JS) for offline loading | **Critical** | |

### 4.8 Setup and Onboarding

| ID | Requirement | Priority | Notes |
|---|---|---|---|
| **SET-01** | On first launch, the system shall display an onboarding wizard | **Critical** | |
| **SET-02** | The wizard shall: (1) ask for store name, (2) provide a link to copy the Google Sheet template, (3) ask for the sheet URL/web app URL | **Critical** | |
| **SET-03** | The system shall validate the Google Sheets connection before proceeding | **Critical** | |
| **SET-04** | The system shall provide a help/FAQ page accessible from the main menu | Medium | |
| **SET-05** | The system shall allow resetting the store data and re-linking to a new sheet | High | |

---

## 5. Data Model

### 5.1 IndexedDB Schema (Client-Side)

#### `products` Object Store

| Field | Type | Required | Description |
|---|---|---|---|
| `barcode` | String | Yes | Primary key — the scanned barcode (EAN-13, UPC, etc.) |
| `productName` | String | Yes | Display name of product |
| `category` | String | No | Product category (e.g., Beverages, Grains, Toiletries) |
| `sellingPrice` | Number | Yes | Unit selling price in local currency (FCFA) |
| `costPrice` | Number | No | Unit cost price (for margin calculation) |
| `unit` | String | No | piece, kg, litre, etc. Default: "piece" |
| `stockQuantity` | Number | Yes | Current available stock |
| `lowStockThreshold` | Number | Yes | Minimum stock before alert (default: 5) |
| `isArchived` | Boolean | No | Soft delete flag |
| `createdAt` | String (ISO) | Yes | Timestamp of product creation |
| `updatedAt` | String (ISO) | Yes | Timestamp of last update |
| `lastSyncedAt` | String (ISO) | No | Timestamp of last sync to Google Sheets |

#### `transactions` Object Store

| Field | Type | Required | Description |
|---|---|---|---|
| `transactionId` | String | Yes | Primary key — UUID or timestamp-based |
| `items` | Array | Yes | List of line items (see below) |
| `subtotal` | Number | Yes | Sum of all line totals before tax |
| `taxAmount` | Number | No | Tax (e.g., VAT) if applicable |
| `total` | Number | Yes | Final amount due |
| `amountTendered` | Number | Yes | Amount paid by customer |
| `change` | Number | Yes | Change returned to customer |
| `paymentMethod` | String | Yes | cash, mobile_money, bank_transfer |
| `status` | String | Yes | completed, voided, pending_sync |
| `createdAt` | String (ISO) | Yes | Transaction timestamp |
| `syncedAt` | String (ISO) | No | Timestamp when synced to Google Sheets |

#### Transaction Line Item

| Field | Type | Required | Description |
|---|---|---|---|
| `barcode` | String | Yes | Product barcode |
| `productName` | String | Yes | Product name at time of sale |
| `quantity` | Number | Yes | Quantity purchased |
| `unitPrice` | Number | Yes | Unit price at time of sale |
| `lineTotal` | Number | Yes | quantity × unitPrice |

#### `syncQueue` Object Store

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | Number (autoIncrement) | Yes | Primary key |
| `action` | String | Yes | "create_product", "update_product", "create_sale" |
| `payload` | Object | Yes | The data to sync |
| `status` | String | Yes | pending, in_progress, failed |
| `retryCount` | Number | Yes | Number of retry attempts |
| `createdAt` | String (ISO) | Yes | Timestamp when queued |
| `lastAttemptAt` | String (ISO) | No | Timestamp of last sync attempt |

### 5.2 Google Sheets Schema

#### Tab 1: `Products`

| Column | Header | Type | Description |
|---|---|---|---|
| A | `barcode` | String | Unique product identifier |
| B | `productName` | String | Product name |
| C | `category` | String | Category |
| D | `sellingPrice` | Number | Unit selling price (FCFA) |
| E | `costPrice` | Number | Unit cost price |
| F | `unit` | String | piece / kg / litre |
| G | `stockQuantity` | Number | Current stock |
| H | `lowStockThreshold` | Number | Alert threshold |
| I | `isArchived` | Boolean | Archived flag |
| J | `createdAt` | String | Creation timestamp |
| K | `updatedAt` | String | Last update timestamp |

#### Tab 2: `Sales`

| Column | Header | Type | Description |
|---|---|---|---|
| A | `transactionId` | String | Unique sale ID |
| B | `items` | String | JSON string of line items |
| C | `itemCount` | Number | Total count of distinct items in sale |
| D | `subtotal` | Number | Sum before tax |
| E | `taxAmount` | Number | Tax |
| F | `total` | Number | Final total |
| G | `amountTendered` | Number | Amount paid |
| H | `change` | Number | Change given |
| I | `paymentMethod` | String | cash / mobile_money / bank_transfer |
| J | `status` | String | completed / voided |
| K | `createdAt` | String | Sale timestamp |

#### Tab 3: `Settings`

| Column | Header | Type | Description |
|---|---|---|---|
| A | `key` | String | Setting name |
| B | `value` | String | Setting value |
| C | `updatedAt` | String | Last update timestamp |

*Pre-populated rows:* `storeName`, `currency` (default: "XAF"), `taxRate`, `taxEnabled` (default: "false")

---

## 6. Non-Functional Requirements

### 6.1 Performance

| ID | Requirement | Target |
|---|---|---|
| **NFR-PERF-01** | App shell loads and becomes interactive in ≤ 3 seconds on a 3G connection | ≤ 3s |
| **NFR-PERF-02** | Barcode scan-to-result time (including online lookup) | ≤ 2 seconds |
| **NFR-PERF-03** | Checkout total calculation updates in real-time (no perceptible delay) | ≤ 100ms |
| **NFR-PERF-04** | Google Sheets sync for a single sale completes within | ≤ 3 seconds (online) |
| **NFR-PERF-05** | Product catalogue search returns results within | ≤ 500ms (cached) |
| **NFR-PERF-06** | App total size (all assets including service worker) | ≤ 2 MB |

### 6.2 Availability and Reliability

| ID | Requirement | Target |
|---|---|---|
| **NFR-AVR-01** | Offline checkout availability | 100% (no server dependency) |
| **NFR-AVR-02** | Google Sheets sync success rate (once online) | ≥ 99.5% |
| **NFR-AVR-03** | Data loss in offline transactions | Zero — queued until acknowledged by sheet |
| **NFR-AVR-04** | Graceful degradation when Google Sheets API is unreachable | Full POS functionality preserved |

### 6.3 Security

| ID | Requirement | Target |
|---|---|---|
| **NFR-SEC-01** | No user authentication data stored in plain text | |
| **NFR-SEC-02** | Google Sheets API URL stored in IndexedDB (never exposed to third parties) | |
| **NFR-SEC-03** | Optional device-level PIN lock on app launch | |
| **NFR-SEC-04** | All communication with Google Sheets API over HTTPS | |
| **NFR-SEC-05** | The Google Apps Script shall validate all incoming requests with a shared secret token | |

### 6.4 Usability

| ID | Requirement | Target |
|---|---|---|
| **NFR-USE-01** | All text and labels shall be in English (with i18n support for French in Phase 2) | |
| **NFR-USE-02** | Font size shall be at least 16px for body text (readability on small screens) | |
| **NFR-USE-03** | Touch targets shall be at least 48×48px (accessibility) | |
| **NFR-USE-04** | The app shall use clear, high-contrast colours; avoid low-contrast grey-on-grey | |
| **NFR-USE-05** | Loading states, empty states, and error states shall all have distinct visual feedback | |
| **NFR-USE-06** | The app shall require at most 3 taps/clicks to reach any core function | |
| **NFR-USE-07** | Critical actions (finalise sale, delete product) shall require a confirmation step | |

### 6.5 Compatibility

| ID | Requirement | Target |
|---|---|---|
| **NFR-COMP-01** | Works on Android Chrome (version 80+) | |
| **NFR-COMP-02** | Works on iOS Safari (version 14+) | |
| **NFR-COMP-03** | Works on desktop Chrome, Firefox, Edge | |
| **NFR-COMP-04** | Camera-based barcode scanning works on browsers that support `getUserMedia` or `BarcodeDetector` | |
| **NFR-COMP-05** | Graceful fallback to text input for barcode scanning on unsupported browsers | |

### 6.6 Maintainability

| ID | Requirement | Target |
|---|---|---|
| **NFR-MAIN-01** | Codebase shall be organised in modular JavaScript files with clear separation of concerns | |
| **NFR-MAIN-02** | Google Apps Script shall be version-controlled alongside the main codebase | |
| **NFR-MAIN-03** | All data access shall go through a single Data Access Layer (DAL) module to ease future backend migration | |
| **NFR-MAIN-04** | The UI shall use CSS custom properties (variables) for theming | |

### 6.7 Offline / Sync

| ID | Requirement | Target |
|---|---|---|
| **NFR-OFF-01** | Offline queue shall persist across browser restarts | |
| **NFR-OFF-02** | Sync shall be incremental (only changed records, not full re-upload) | |
| **NFR-OFF-03** | Sync retry with exponential backoff (1s, 2s, 4s, 8s, max 60s) for transient failures | |
| **NFR-OFF-04** | User shall be able to view pending sync items count at all times | |

---

## 7. UI/UX Requirements

### 7.1 Navigation Structure

```
┌───────────────────────────────────────────────────┐
│  [Home / Dashboard]                                │
│  ┌─────────────┐  ┌──────────┐  ┌─────────────┐   │
│  │  Scan Item   │  │  Checkout│  │  Inventory  │   │
│  │  (Add Stock) │  │  (POS)   │  │  (List All) │   │
│  └─────────────┘  └──────────┘  └─────────────┘   │
│  ┌─────────────┐  ┌──────────┐  ┌─────────────┐   │
│  │  Sales       │  │  Stock   │  │  Settings   │   │
│  │  History     │  │  Alerts  │  │             │   │
│  └─────────────┘  └──────────┘  └─────────────┘   │
│                                                    │
│  Bottom Navigation Bar (mobile) /                  │
│  Sidebar (desktop)                                 │
└───────────────────────────────────────────────────┘
```

### 7.2 Key Screens (Mobile-Optimised)

#### Screen 1: Dashboard

- Summary cards at top: Today's Sales (amount), Products in Stock, Low Stock Alerts
- Quick action buttons: "New Sale" (large, prominent), "Scan Item"
- Recent transactions list (last 5 sales)
- Offline/online indicator in header

#### Screen 2: Checkout (POS)

- Large scan area at top (tap to scan, or camera live view)
- Invoice list below with swipe-to-delete on line items
- Quantity adjuster (+/- buttons) on each line item
- Footer always visible: subtotal, total, "Complete Sale" button
- Payment entry screen (modal): amount tendered, change, payment method selector

#### Screen 3: Inventory Scanner

- Full-screen camera view with barcode overlay
- After successful scan: product details card appears with editable fields
- "Save Product" and "Add More" buttons
- Button to switch to manual entry mode

#### Screen 4: Inventory List

- Search bar at top
- Filterable by category or stock status (in stock / low stock / out of stock)
- Product rows: name, barcode, price, stock count, colour-coded stock level indicator
- Tap to edit product

#### Screen 5: Stock Alerts

- List of products where stock ≤ lowStockThreshold
- Quick action: "Receive Stock" button per item
- Grouped by severity: "Out of Stock" (red), "Low Stock" (amber)

### 7.3 Responsive Breakpoints

| Breakpoint | Target Devices | Layout |
|---|---|---|
| 320–480px | Small phones | Single column, bottom nav |
| 481–768px | Large phones / phablets | Single column, bottom nav |
| 769–1024px | Tablets | Two-column, left nav |
| 1025px+ | Desktop | Sidebar navigation, full-width content |

---

## 8. Constraints and Assumptions

### 8.1 Technical Constraints

1. **Google Apps Script quotas:** 90 minutes/day total execution, 6 minutes per trigger, 30 simultaneous triggers — must design sync strategy within these limits
2. **No server backend:** No user accounts, no cloud database, no authentication system — the app is fully client-side
3. **Barcode SDK limitations:** `BarcodeDetector` API is not supported on all browsers; `html5-qrcode` library is the fallback
4. **Camera access:** Requires user to grant camera permission; some older browsers may not support `getUserMedia`
5. **IndexedDB storage limits:** Up to ~50% of available disk space in Chrome, varies by browser
6. **No push notifications** without a server (service workers can show notifications only from within the PWA context)

### 8.2 Business Constraints

1. **No payment gateway integration** — payments are recorded manually (cash or mobile money). The app does not process payments.
2. **No inventory barcode generation** — the system reads existing barcodes; it does not print barcode labels (future phase)
3. **Single-user per device** — no user login/role system; the phone is the cashier
4. **Data sovereignty** — data lives in the user's own Google Sheet, not on any third-party server

### 8.3 Assumptions

1. User has a Google account and can copy a Sheet template
2. User has internet access at least once per day for syncing
3. Phone camera can focus on barcodes at a distance of 10–30 cm
4. Products sold have existing barcodes (manufacturer barcodes), OR user is willing to assign internal barcodes
5. The user is comfortable granting camera permission and sheet access

---

## 9. Appendix: Glossary

| Term | Definition |
|---|---|
| **Barcode** | A machine-readable code (EAN-13, UPC, Code 128, QR) encoding a product identifier |
| **EAN-13** | 13-digit barcode standard used globally for retail products |
| **FCFA** | Central African CFA franc (XAF) — currency used in Cameroon and other CEMAC countries |
| **Google Apps Script** | JavaScript-based platform for extending Google Workspace apps; used here to create a REST API for the sheet |
| **IndexedDB** | Client-side NoSQL database built into browsers; used for offline product and transaction storage |
| **Line Item** | A single product entry in an invoice (barcode, name, quantity, unit price, line total) |
| **Micro-Retailer** | A small retail business with 1–5 employees, typically operating in a single location |
| **PWA** | Progressive Web App — a web application that uses modern browser capabilities to deliver an app-like experience |
| **Service Worker** | A browser script that runs in the background, enabling offline caching and background sync |
| **Stockout** | A situation where a product's inventory reaches zero and is unavailable for sale |
| **Threshold** | The minimum stock level that triggers a reorder alert |

---

*End of System Requirements Specification v1.0*

*Document prepared July 2026*
