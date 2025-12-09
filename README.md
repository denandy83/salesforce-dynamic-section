# ND Dynamic Section (LWC)

**Component Type:** Salesforce Lightning Web Component (LWC)  
**Scope:** Record Pages (Lightning App Builder)  
**Version:** 2.0  

## Overview

The **ND Dynamic Section** is a configurable container component for Salesforce Record Pages. It enhances standard page layouts by offering:

* **Dynamic Header Colors:** Change header background based on field values (e.g., Red for "High Priority").
* **Smart Titles:** Inject record data directly into the section title (e.g., "Risk Analysis (5 Warnings)").
* **Conditional Visibility:** Hide/Show specific fields based on logic within the section.
* **Alert Strips:** Visual color-coded strips on specific fields to highlight critical data.
* **Multi-Value Logic:** Support for triggering alerts on lists of values (e.g., "Working, Escalated").

---

## Configuration (App Builder)

When adding this component to a Lightning Page via the App Builder, the following properties are available in the properties pane:

| Property | Type | Description | Example |
| :--- | :--- | :--- | :--- |
| **Title** | String | The header text. Supports `{API_Name}` injection. | `Details ({Warning_Count__c})` |
| **Icon Name** | String | SLDS Icon name. | `utility:warning` |
| **Header Background** | Hex | Default background color. | `#005FB2` |
| **Header Text Color** | Hex | Default text color. | `#FFFFFF` |
| **Field JSON Config** | String | JSON Array defining the body fields. | *(See JSON Configuration)* |
| **Trigger Field** | String | API Name of the field controlling header color. | `Status` |
| **Trigger Value** | String | Value(s) to match. Supports comma-separated lists. | `Working, Escalated` |
| **Active Color** | Hex | Color to apply when trigger condition is met. | `#D8000C` |

---

## JSON Configuration Guide

The **Field JSON Configuration** property controls the body content. It expects a **JSON Array of Objects**.

### Supported Keys

| Key | Required | Type | Description |
| :--- | :--- | :--- | :--- |
| `apiName` | **Yes** | String | The API Name of the field to display. |
| `label` | No | String | Overrides the default Salesforce label. |
| `editable` | No | Boolean | Set `true` to enable inline editing. Default: `false`. |
| `showIfField` | No | String | API Name of the field to check for visibility. |
| `showIfValue` | No | String | The value `showIfField` must match to show this field. |
| `color` | No | String | Hex code or name (e.g., `"red"`) for the alert strip. |
| `colorIfField` | No | String | API Name of field to check before applying color. |
| `colorIfValue` | No | String | The value `colorIfField` must match to apply color. |

### Configuration Examples

#### 1. Basic Read-Only Field
```json
[
  { "apiName": "Description" }
]
```

#### 2. Editable Field with Custom Label
```json
[
  { 
    "apiName": "Next_Steps__c", 
    "label": "Technician Notes", 
    "editable": true 
  }
]
```

#### 3. Conditional Visibility
*Only show "Loss Reason" if "Status" is "Closed Lost".*
```json
[
  {
    "apiName": "Loss_Reason__c",
    "showIfField": "Status",
    "showIfValue": "Closed Lost"
  }
]
```

#### 4. Conditional Alert Strip
*Show a yellow strip next to the date ONLY if "Priority" is "High".*
```json
[
  {
    "apiName": "Due_Date__c",
    "color": "#FFCC00",
    "colorIfField": "Priority",
    "colorIfValue": "High"
  }
]
```

#### 5. Phantom Field (For Title Logic)
*Use this pattern to load data for the Title (e.g., a count) without displaying the field in the list body.*
```json
[
  {
    "apiName": "Warning_Count__c",
    "//": "Load the data but hide the field using an impossible condition",
    "showIfField": "Warning_Count__c",
    "showIfValue": "HIDE_ME_PLEASE"
  }
]
```

---

## Dynamic Header Logic

The header background can change color based on record data. Configure this in the **App Builder** sidebar.

### Scenario A: Boolean / Checkbox Logic
*Turn Red if `Is_Escalated__c` is Checked.*
* **Trigger Field:** `Is_Escalated__c`
* **Trigger Value:** *(Leave Empty)*
* **Active Color:** `#D8000C`

### Scenario B: Single Value Match
*Turn Red if `Status` is exactly "Working".*
* **Trigger Field:** `Status`
* **Trigger Value:** `Working`
* **Active Color:** `#D8000C`

### Scenario C: Multi-Value Match
*Turn Red if `Status` is "Working" OR "Escalated" OR "High Priority".*
* **Trigger Field:** `Status`
* **Trigger Value:** `Working, Escalated, High Priority`
* **Active Color:** `#D8000C`

---

## Smart Title Logic

You can inject field values directly into the Section Title using curly braces `{}`.

**Syntax:** `My Title ({API_Name})`

**Requirements:**
1. The field used in the title **must** be loaded by the component.
2. It must be included in your JSON configuration (either as a visible field or a "Phantom Field" - see Example 5).

**Example:**
* **App Builder Title:** `Risk Analysis ({Warning_Count__c} Warnings)`
* **JSON:** Must include `{"apiName": "Warning_Count__c" ...}`
* **Result:** `Risk Analysis (5 Warnings)`

---

## Troubleshooting

| Issue | Solution |
| :--- | :--- |
| **Title shows `()` instead of `(5)`** | Ensure the field in the `{}` is present in your Field JSON. If you don't want it visible in the list, use the "Phantom Field" config. |
| **Header color won't change** | Check for typos in the **Trigger Field** API Name. Ensure **Trigger Value** does NOT contain curly braces (e.g., use `Working`, not `{Working}`). |
