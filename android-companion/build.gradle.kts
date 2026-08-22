plugins {
    id("com.android.application") version "8.13.0" apply false
    id("org.jetbrains.kotlin.android") version "2.2.20" apply false
}

tasks.wrapper {
    gradleVersion = "8.14.3"
    distributionType = org.gradle.api.tasks.wrapper.Wrapper.DistributionType.ALL
    validateDistributionUrl = false
}
