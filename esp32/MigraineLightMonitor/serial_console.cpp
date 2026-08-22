#include "serial_console.h"

#include <stdlib.h>
#include <string.h>

#include "config.h"
#include "self_test.h"

void SerialConsole::begin() { printHelp(); }

void SerialConsole::printHelp() {
  Serial.println("[INFO] Serial commands:");
  Serial.println("  HELP");
  Serial.println("  STATUS");
  Serial.println("  TIME <UTC epoch milliseconds>");
  Serial.println("  WIFI_STATUS");
  Serial.println("  WIFI_PORTAL");
  Serial.println("  WIFI_FORGET");
  Serial.println("  LIST_EVENTS");
  Serial.println("  DUMP_EVENT <event_id>");
  Serial.println("  DUMP_LEGACY");
  Serial.println("  MOTOR");
  Serial.println("  SELFTEST");
  if (Config::ENABLE_TEST_DELETE_COMMAND) {
    Serial.println("  TEST_ACK_COMPLETE <event_id>");
  }
}

void SerialConsole::handle(char *command, uint64_t nowUs) {
  while (*command == ' ') {
    ++command;
  }
  if (strcmp(command, "HELP") == 0) {
    printHelp();
  } else if (strcmp(command, "STATUS") == 0) {
    Serial.print("device_state=");
    Serial.println(deviceStateName(events_.state()));
    Serial.print("history_count=");
    Serial.println(history_.size());
    Serial.print("clock_synchronized=");
    Serial.println(timeKeeper_.isSynchronized() ? "true" : "false");
    Serial.print("boot_id=");
    Serial.println(timeKeeper_.bootId(), HEX);
    network_.printStatus(Serial);
    timeSync_.printStatus(Serial);
    if (events_.recording()) {
      Serial.print("active_event_id=");
      Serial.println(events_.eventId());
      Serial.print("active_samples=");
      Serial.println(events_.activeSampleCount());
      Serial.print("missed_active_slots=");
      Serial.println(events_.missedActiveSlots());
    }
    storage_.printStatus(Serial);
  } else if (strncmp(command, "TIME ", 5) == 0) {
    char *end = nullptr;
    const int64_t epochMs = strtoll(command + 5, &end, 10);
    if (end == command + 5 || *end != '\0' ||
        !timeKeeper_.setUtcEpochMs(epochMs, nowUs)) {
      Serial.println("[ERROR] TIME expects UTC epoch milliseconds (2000-2100)");
    } else {
      Serial.println("[INFO] UTC clock synchronized for this boot");
    }
  } else if (strcmp(command, "WIFI_STATUS") == 0) {
    network_.printStatus(Serial);
    timeSync_.printStatus(Serial);
  } else if (strcmp(command, "WIFI_PORTAL") == 0) {
    Serial.println(network_.requestPortal(nowUs)
                       ? "[INFO] Wi-Fi setup portal is active"
                       : "[ERROR] Wi-Fi setup portal could not start");
  } else if (strcmp(command, "WIFI_FORGET") == 0) {
    network_.forgetCredentials(nowUs);
  } else if (strcmp(command, "LIST_EVENTS") == 0) {
    storage_.printEventList(Serial);
  } else if (strncmp(command, "DUMP_EVENT ", 11) == 0) {
    if (!storage_.dumpEventCsv(command + 11, Serial)) {
      Serial.println("[ERROR] Event not found or header invalid");
    }
  } else if (strcmp(command, "DUMP_LEGACY") == 0) {
    storage_.dumpLegacy(Serial);
  } else if (strcmp(command, "MOTOR") == 0) {
    alerts_.manualMotorTest(nowUs);
  } else if (strcmp(command, "SELFTEST") == 0) {
    if (events_.recording()) {
      Serial.println("[ERROR] SELFTEST unavailable during event recording");
    } else {
      runFirmwareSelfTests(Serial);
    }
  } else if (Config::ENABLE_TEST_DELETE_COMMAND &&
             strncmp(command, "TEST_ACK_COMPLETE ", 18) == 0) {
    Serial.println(storage_.deleteAfterServerConfirmation(command + 18)
                       ? "[TEST] Confirmed event removed"
                       : "[TEST] Event removal rejected");
  } else if (*command != '\0') {
    Serial.println("[ERROR] Unknown command; enter HELP");
  }
}

void SerialConsole::tick(uint64_t nowUs) {
  while (Serial.available() > 0) {
    const char value = static_cast<char>(Serial.read());
    if (value == '\r' || value == '\n') {
      if (inputLength_ > 0) {
        input_[inputLength_] = '\0';
        handle(input_, nowUs);
        inputLength_ = 0;
      }
    } else if (inputLength_ + 1U < sizeof(input_)) {
      input_[inputLength_++] = value;
    } else {
      inputLength_ = 0;
      Serial.println("[ERROR] Serial command too long");
    }
  }
}
