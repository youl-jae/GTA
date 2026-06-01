<template>
  <div>

    <div class="sub-title-group">

      <!-- Title -->
      <div
        style="
          display: flex;
          align-items: center;
        "
      >

        <span class="sub-title">
          Admin Page
        </span>

        <b-badge
          v-if="serverRole"
          :variant="
            serverRole === 'MASTER'
              ? 'success'
              : 'warning'
          "
          style="
            margin-left: 0.5rem;
            font-size: 0.8rem;
          "
        >
          {{ serverRole }} Server
        </b-badge>

      </div>

      <!-- Right Buttons -->
      <div style="display: flex; align-items: center;">

        <!-- Host 선택 -->
        <b-form-select
          size="sm"
          v-model="dbHost"
          :options="hostOptions"
          style="width: 220px; margin-right: 0.5rem;"
        />

        <!-- 입력 정보 수정 -->
        <b-button
          variant="primary"
          size="sm"
          style="margin-right: 0.5rem;"
          @click="$bvModal.show('modify-input-info')"
        >
          Modify Input Info
        </b-button>

        <!-- 동기화 -->
        <b-button
          variant="primary"
          size="sm"
          style="margin-right: 0.5rem;"
          @click="syncServer"
        >
          Sync Server
        </b-button>

        <!-- Table Sync Config -->
        <b-button
          variant="success"
          size="sm"
          @click="$bvModal.show('table-sync-config-modal')"
        >
          Table Sync Config
        </b-button>

      </div>

    </div>

    <!-- 결과 메시지 -->
    <div
      v-if="message"
      style="margin-top: 1rem;"
    >
      <b-alert
        :variant="isSuccess ? 'success' : 'danger'"
        show
      >
        {{ message }}
      </b-alert>
    </div>

    <!-- ===================================== -->
    <!-- 🔥 Sync Error Logs -->
    <!-- ===================================== -->
    <div
      v-if="showSyncErrorLogs"
      style="
        margin-top: 2rem;
        border: 1px solid #ddd;
        border-radius: 8px;
        padding: 1rem;
      "
    >

      <div
        style="
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 1rem;
        "
      >

        <h5
          style="
            margin: 0;
            font-weight: 600;
          "
        >
          Sync Error Logs
          ({{ syncErrorLogs.length }})
        </h5>

        <div>

          <b-button
            size="sm"
            variant="primary"
            @click="loadSyncErrorLogs"
          >
            Refresh
          </b-button>

        </div>

      </div>

      <b-table
        small
        striped
        bordered
        hover
        :items="syncErrorLogs"
        :fields="syncErrorFields"
      >

      </b-table>

      <!-- pagination -->
      <div
        style="
          display: flex;
          justify-content: center;
          align-items: center;
          margin-top: 1rem;
        "
      >

        <b-button
          size="sm"
          variant="secondary"
          :disabled="offset === 0"
          @click="prevPage"
        >
          Prev
        </b-button>

        <span
          style="
            margin: 0 1rem;
            line-height: 32px;
            font-weight: 600;
          "
        >
          Page: {{ currentPage }}
        </span>

        <b-button
          size="sm"
          variant="secondary"
          @click="nextPage"
        >
          Next
        </b-button>

      </div>

    </div>

    <!-- Modal -->
    <ModifyInputInfoModal
      :host="dbHost"
      :hostOptions="hostOptions"
      :serverRole="serverRole"
      @update="updateInputInfo"
    />

    <TableSyncConfigModal />

  </div>
</template>

<script>

import ModifyInputInfoModal
  from "@/components/modal/ModifyInputInfoModal.vue";

import TableSyncConfigModal
  from "@/components/modal/TableSyncConfigModal.vue";

export default {

  name: "AdminPage",

  components: {
    ModifyInputInfoModal,
    TableSyncConfigModal,
  },

  computed: {

    currentPage() {

      return Math.floor(
        this.offset / this.limit
      ) + 1;
    }
  },

  data() {

    return {

      showSyncErrorLogs: false,

      syncErrorLogs: [],

      syncErrorFields: [

        {
          key: "created_at",
          label: "Created"
        },

        {
          key: "table_name",
          label: "Table"
        },

        {
          key: "error_message",
          label: "Message"
        }

      ],

      limit: 20,

      offset: 0,

      dbHost: "",

      serverRole: "",

      hostOptions: [],

      message: "",

      isSuccess: true,
    };
  },

  mounted() {

    this.loadServerRole();

    this.loadAllowedIps();
  },

  methods: {

    async loadSyncErrorLogs() {

      try {

        const response =
          await this.$http.get(
            "/api/admin/sync-error-logs",
            {
              params: {
                limit: this.limit,
                offset: this.offset
              }
            }
          );

        this.syncErrorLogs =
          response.data;

      } catch (err) {

        console.error(err);

        alert(
          "Sync Error Logs 조회 실패"
        );
      }
    },

    async nextPage() {

      this.offset += this.limit;

      await this.loadSyncErrorLogs();

      if (
        this.syncErrorLogs.length === 0
      ) {

        this.offset -= this.limit;
      }
    },

    async prevPage() {

      if (
        this.offset >= this.limit
      ) {

        this.offset -= this.limit;
      }

      await this.loadSyncErrorLogs();
    },

    async loadAllowedIps() {

      try {

        const response =
          await this.$http.get(
            "/api/admin/allowed-ips"
          );

        this.hostOptions =
          response.data.map(
            (item) => {

              return {

                value: item.ip,

                text:
                  `${item.description} (${item.ip})`,
              };
            }
          );

        if (
          this.hostOptions.length > 0
        ) {

          this.dbHost =
            this.hostOptions[0].value;
        }

      } catch (err) {

        console.error(err);

        alert(
          "Allowed IP 조회 실패"
        );
      }
    },

    updateInputInfo(data) {

      this.dbHost = data.host;

      this.hostOptions =
        data.hostOptions;

      alert(
        "Input 정보 업데이트 완료"
      );
    },

    async loadServerRole() {

      try {

        const response =
          await this.$http.get(
            "/api/admin/server-role"
          );

        this.serverRole =
          response.data.role;

      } catch (err) {

        console.error(err);
      }
    },

    async syncServer() {

      console.log(
        "SYNC 요청 host:",
        this.dbHost
      );

      console.log(
        "TYPE:",
        typeof this.dbHost
      );

      this.message = "";

      this.isSuccess = true;

      if (!this.dbHost) {

        alert("IP 선택 필요");

        this.isSuccess = false;

        return;
      }

      try {

        await this.$http.post(
          "/api/admin/sync",
          {
            targetUrl:
              `http://${this.dbHost}:3000`,
          }
        );

        alert(
          "Sync Server 성공"
        );

        this.message =
          "Sync Server Success!";

        this.isSuccess = true;

        // 성공 시 숨김
        this.showSyncErrorLogs =
          false;

      } catch (err) {

        console.error(err);

        alert(
          "Sync Server 실패"
        );

        this.message =
          err.response?.data ||
          "Sync Server Failed";

        this.isSuccess = false;

        // 실패 시 표시
        this.showSyncErrorLogs =
          true;

        // 첫 페이지부터 다시 조회
        this.offset = 0;

        await this.loadSyncErrorLogs();
      }
    },
  },
};
</script>

<style scoped>

.btn-primary {
  background-color: #4472C4;
  border-color: #4472C4;
}

</style>