chmod +x /home/ubuntu/collect_os_metrics_5s.sh
chmod +x /home/ubuntu/collect_jvb_colibri_5s.sh
chmod +x /home/ubuntu/run_collectors.sh
chmod +x /home/ubuntu/run_os_collector_only.sh


cho scp command để tải file sau từ ssh sv

ssh -i ~/.ssh/key ubuntu@13.222.222.36 - server 
ssh -i ~/.ssh/key ubuntu@107.21.168.223 - test client


scp -i ~/.ssh/key /Users/mvmanh/FAIR2026/terraform/monitor_scripts/*.sh ubuntu@3.84.103.247:/home/ubuntu/
scp -i ~/.ssh/key /Users/mvmanh/FAIR2026/terraform/monitor_scripts/*.sh ubuntu@18.204.209.134:/home/ubuntu/

scp -i ~/.ssh/key /Users/mvmanh/FAIR2026/web_client.zip ubuntu@3.95.29.115:/home/ubuntu/
scp -i ~/.ssh/key /Users/mvmanh/FAIR2026/web_client.zip ubuntu@107.21.168.223:/home/ubuntu/

scp -i ~/.ssh/key /Users/mvmanh/FAIR2026/terraform/monitor_scripts/*.sh ubuntu@18.204.209.134:/home/ubuntu/


getent hosts meeting.maivanmanh.online

zip -r jitsi-metrics.zip jitsi-metrics/

scp -i ~/.ssh/key ubuntu@3.95.29.115:/home/ubuntu/jitsi-metrics.zip ~/Downloads/
scp -i ~/.ssh/key ubuntu@107.21.168.223:/home/ubuntu/jitsi-metrics.zip ~/Downloads/

Add-Content -Path "C:\Windows\System32\drivers\etc\hosts" -Value "`n172.31.84.221 meeting.maivanmanh.online"
ipconfig /flushdns

ping meeting.maivanmanh.online
