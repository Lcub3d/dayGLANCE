# Android health providers

dayGLANCE currently consumes two native health metrics:

- `steps`
- `sleep` (duration + stages)

The Android side treats those as capabilities, not as properties of one hard-coded
vendor API.

## Selection contract

Provider discovery is a device-initialization concern, not a read-time concern.

1. Read the device manufacturer/model.
2. For each supported metric, order registered providers using the manufacturer as
   a hint.
3. Pick the first available provider that supports that metric.
4. Persist the metric -> provider binding in `dayglance_shared`.
5. On later reads and process restarts, resolve that saved provider id directly.
6. Re-discover only when:
   - no binding exists (first run / schema migration),
   - the saved adapter was removed from the app, or
   - the selected provider explicitly reports `provider_unavailable`.
7. Persist a negative (`no provider`) discovery too, so unsupported devices are
   not probed repeatedly.

The selection record is intentionally device-local. `dayglance_shared.xml` is
excluded from Android backup and device transfer, so a provider selected on one
phone cannot leak onto another phone.

## Provider order

The current catalog knows these stable ids:

| Manufacturer hint | Preferred order |
| --- | --- |
| HONOR | `honor_health` -> `health_connect` -> fallbacks |
| HUAWEI | `huawei_health` -> `health_connect` -> fallbacks |
| Samsung | `samsung_health` -> `health_connect` -> fallbacks |
| Other Android | `health_connect` -> optional OEM stores |

Only registered adapters participate. A known id without an adapter is ignored.

## Shipped provider

### Health Connect

`HealthConnectProvider` is the generic provider and currently ships in the app.
It supports both dayGLANCE metrics.

The bridge returns status explicitly:

- `ok`
- `no_data`
- `no_permission`
- `provider_unavailable`
- `error`

A real zero is therefore no longer conflated with a failed read.

## OEM adapters

Direct OEM APIs are deliberately adapters rather than branches inside
`HealthRepository`. Register a new implementation in
`AndroidHealthProviderRegistry`.

Vendor SDKs that require an account sign-in/consent activity also need an
authorization delegate owned by the Android Activity. Keep that authorization
flow outside the normal read path; successful authorization should update the
provider's local credential state and then the persisted provider binding can be
used directly on subsequent reads.

The provider contract already supports partial capability sets, so a future device
may use one provider for steps and another for sleep without changing the web data
model.

Direct OEM integrations also have vendor-side prerequisites that must not be
hard-coded into this repository:

- HONOR Health Kit requires an HONOR developer application, the Health Kit scopes,
  HONOR account authorization, and app credentials/configuration.
- HUAWEI Health Kit requires an HMS/AGC application and approved Health Kit data
  permissions.
- Samsung Health Data SDK requires Samsung's SDK package and distribution
  registration/partnership for production use.

When one of these adapters is added, bump
`HealthProviderManager.SELECTION_SCHEMA_VERSION` so devices that previously
persisted "no provider" perform exactly one fresh discovery after the app update.

## Compatibility

The web habit field `source: 'healthConnect'` is retained as a legacy Android
platform tag for sync compatibility. It no longer means the native read must come
from Health Connect; provider selection is private to the Android native layer.
