#pragma once

#include <Arduino.h>

#include "alerts.h"
#include "circular_buffer.h"
#include "event_manager.h"
#include "network_manager.h"
#include "storage.h"
#include "time_keeper.h"
#include "time_sync_manager.h"

class SerialConsole {
 public:
  SerialConsole(TimeKeeper &timeKeeper, StorageManager &storage,
                EventManager &events, HistoryBuffer &history,
                AlertManager &alerts, WifiProvisioningManager &network,
                TimeSyncManager &timeSync)
      : timeKeeper_(timeKeeper),
        storage_(storage),
        events_(events),
        history_(history),
        alerts_(alerts),
        network_(network),
        timeSync_(timeSync) {}

  void begin();
  void tick(uint64_t nowUs);

 private:
  void handle(char *command, uint64_t nowUs);
  void printHelp();

  TimeKeeper &timeKeeper_;
  StorageManager &storage_;
  EventManager &events_;
  HistoryBuffer &history_;
  AlertManager &alerts_;
  WifiProvisioningManager &network_;
  TimeSyncManager &timeSync_;
  char input_[160] = {};
  size_t inputLength_ = 0;
};
