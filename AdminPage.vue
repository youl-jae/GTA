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

  data() {

    return {

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

        // 첫 번째 IP 자동 선택
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

    // Modal에서 값 업데이트
    updateInputInfo(data) {

      this.dbHost = data.host;

      // Host 목록 갱신
      this.hostOptions = data.hostOptions;

      alert("Input 정보 업데이트 완료");
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

        alert("Sync Server 성공");

        this.message =
          "Sync Server Success!";

        this.isSuccess = true;

      } catch (err) {

        console.error(err);

        alert("Sync Server 실패");

        this.message =
          err.response?.data ||
          "Sync Server Failed";

        this.isSuccess = false;
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