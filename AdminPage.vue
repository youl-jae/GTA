<template>
  <div>
    <div class="sub-title-group">
      <span class="sub-title">Admin Page</span>

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
          @click="syncServer"
        >
          Sync Server
        </b-button>

      </div>
    </div>

    <!-- 결과 메시지 -->
    <div v-if="message" style="margin-top: 1rem;">
      <b-alert :variant="isSuccess ? 'success' : 'danger'" show>
        {{ message }}
      </b-alert>
    </div>

    <!-- Modal -->
    <ModifyInputInfoModal
      :host="dbHost"
      :hostOptions="hostOptions"
      @update="updateInputInfo"
    />

  </div>
</template>

<script>
import ModifyInputInfoModal from "@/components/modal/ModifyInputInfoModal.vue";

export default {
  name: "AdminPage",

  components: {
    ModifyInputInfoModal,
  },

  data() {
    return {
      dbHost: "192.168.1.12",

      hostOptions: [
        { value: "192.168.1.12", text: "KR01 (192.168.1.12)" },
        { value: "192.168.1.8", text: "KR01 (192.168.1.8)" },
      ],

      message: "",
      isSuccess: true,
    };
  },

  methods: {

    // Modal에서 값 업데이트
    updateInputInfo(data) {
      this.dbHost = data.host;

      // Host 목록 갱신
      this.hostOptions = data.hostOptions;

      alert("Input 정보 업데이트 완료");
    },

    async syncServer() {

      console.log("SYNC 요청 host:", this.dbHost);
      console.log("TYPE:", typeof this.dbHost);

      this.message = "";
      this.isSuccess = true;

      if (!this.dbHost) {
        alert("IP 선택 필요");
        this.isSuccess = false;
        return;
      }

      try {

        await this.$http.post("/api/admin/sync", {
          masterUrl: `http://${this.dbHost}:3000`,
        });

        alert("Sync Server 성공");

        this.message = "Sync Server Success!";
        this.isSuccess = true;

      } catch (err) {

        console.error(err);

        alert("Sync Server 실패");

        this.message =
          err.response?.data || "Sync Server Failed";

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