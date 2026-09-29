---
title: "API Documentation :: Gold API"
source: "https://gold-api.com/docs"
author:
published:
created: 2026-05-17
description: "Comprehensive API documentation for our gold price API"
tags:
  - "clippings"
---
## API Documentation

Base URL:`https://api.gold-api.com`

GET

## Get Symbols

Retrieves all available symbols.

### Authentication

No authentication required - Free endpoint with no rate limits

### Endpoint

`GET https://api.gold-api.com/symbols`

### Response

| Field | Type | Description |
| --- | --- | --- |
| `symbol` | string | The asset symbol |
| `name` | string | The full name of the asset |

### Try it out

### API Tester

#### Response:

```
[
  {
    "name": "Silver",
    "symbol": "XAG"
  },
  {
    "name": "Gold",
    "symbol": "XAU"
  },
  {
    "name": "Bitcoin",
    "symbol": "BTC"
  },
  {
    "name": "Ethereum",
    "symbol": "ETH"
  },
  {
    "name": "Palladium",
    "symbol": "XPD"
  },
  {
    "name": "Copper",
    "symbol": "HG"
  },
  {
    "name": "Platinum",
    "symbol": "XPT"
  }
]
```