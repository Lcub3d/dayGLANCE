# Android HONOR Health provider

The Android health layer prefers HONOR Health Kit on supported HONOR devices and
falls back to Health Connect when the HONOR integration is not configured or
unavailable.

dayGLANCE currently reads two health metrics:

- steps
- sleep duration and stages

## Why this is a provider

HONOR Health does not necessarily publish these records to Health Connect. The
HONOR adapter therefore implements the same native health-provider contract as
Health Connect instead of adding HONOR checks to the web layer.

Provider selection is persisted per metric on the device. Normal reads do not
re-probe every provider.

## HONOR developer setup

Create an Android application in HONOR Developers and configure the package name
and signing-certificate SHA-256 for the APK that will be installed.

Enable the account service and request Health Kit read access for:

- `https://www.hihonor.com/healthkit/step.read`
- `https://www.hihonor.com/healthkit/sleep.read`

The Android build needs the public app id:

```text
HONOR_APP_ID=...
```

It can be supplied as a Gradle property or environment variable. The token
exchange URL defaults to the hosted dayGLANCE endpoint and can be overridden:

```text
HONOR_TOKEN_EXCHANGE_URL=https://example.com/api/honor-token
```

## Server configuration

The authorization code returned by HONOR ID is exchanged server-side. Never put
the client secret in an APK.

Configure the serverless deployment with:

```text
HONOR_APP_ID=...
HONOR_CLIENT_SECRET=...
HONOR_REDIRECT_URI=honorid://redirect_url
```

`HONOR_REDIRECT_URI` is optional when the application uses HONOR's default
redirect URI. `HONOR_TOKEN_URL` can also be overridden if HONOR assigns a
regional OAuth endpoint.

Only the account authorization code / refresh token goes through this endpoint.
Steps and sleep data are read directly on the device through HONOR Health Kit.

## Testing

HONOR validates the Android package and signing certificate. A CI-generated
debug APK normally has an ephemeral debug certificate and cannot be used for
account authorization unless that exact certificate is registered.

Use a stable signing key for device testing and register its SHA-256 in the
HONOR developer application.
