// swift-tools-version:5.9
//
// DayDialGeometry — the Day Dial's geometry, ported from src/utils/dayDial.js.
//
// Pure Foundation, no UI: Phase 1 of docs/day-dial-widget-handoff.md §9 is
// "Swift agrees with dayDial.js on every exported vector", and the vectors
// are the contract (dayglance-ios/TestFixtures/dayDial.vectors.json, produced
// by `npm run ios:vectors`). The test target loads that file and asserts every
// geometry case; `swift test --package-path dayglance-ios/Packages/DayDialGeometry`
// runs it on a Mac with no simulator, which is also what ios.yml does.
//
// Kept as a package rather than files in the widget target so the tests run
// without a host app, and so a future Kotlin port has one spec to read.
import PackageDescription

let package = Package(
    name: "DayDialGeometry",
    platforms: [.iOS(.v17), .macOS(.v13)],
    products: [
        .library(name: "DayDialGeometry", targets: ["DayDialGeometry"]),
    ],
    targets: [
        .target(name: "DayDialGeometry"),
        .testTarget(name: "DayDialGeometryTests", dependencies: ["DayDialGeometry"]),
    ]
)
